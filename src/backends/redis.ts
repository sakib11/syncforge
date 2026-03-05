/**
 * syncforge
 * Redis storage backend.
 *
 * Uses ioredis (optional peer dependency) to persist records in Redis hashes.
 * Each collection is stored as a Redis hash keyed by `${prefix}:${collection}`.
 * A sorted set `${prefix}:${collection}:ts` indexes records by timestamp for
 * efficient `getChangesSince` queries.
 *
 * Requires `ioredis` ^5.0.0 to be installed.
 */

import { StorageBackend, StoredRecord, RedisConfig } from '../types';

// ioredis types — we use a minimal interface to avoid requiring the type
// package at compile time. The actual ioredis instance is injected at runtime.
interface RedisClient {
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number | string>;
  zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  quit(): Promise<string>;
  pipeline(): RedisPipeline;
}

interface RedisPipeline {
  hset(key: string, field: string, value: string): this;
  zadd(key: string, score: number, member: string): this;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

export class RedisBackend implements StorageBackend {
  private client: RedisClient;
  private prefix: string;
  private collectionsKey: string;

  constructor(config: RedisConfig) {
    // Dynamically require ioredis so the dependency is optional
    let Redis: new (opts: Record<string, unknown>) => RedisClient;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Redis = require('ioredis') as typeof Redis;
    } catch {
      throw new Error(
        '[SyncForge] Redis backend requires the "ioredis" package. ' +
          'Install it with: npm install ioredis'
      );
    }

    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db ?? 0,
      tls: config.tls ? {} : undefined,
    });

    this.prefix = config.keyPrefix ?? 'dse';
    this.collectionsKey = `${this.prefix}:__collections__`;
  }

  private hashKey(collection: string): string {
    return `${this.prefix}:${collection}`;
  }

  private tsKey(collection: string): string {
    return `${this.prefix}:${collection}:ts`;
  }

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    const raw = await this.client.hget(this.hashKey(collection), id);
    if (!raw) return null;
    return JSON.parse(raw) as StoredRecord;
  }

  async getAll(collection: string): Promise<StoredRecord[]> {
    const all = await this.client.hgetall(this.hashKey(collection));
    return Object.values(all).map((raw) => JSON.parse(raw) as StoredRecord);
  }

  async set(collection: string, record: StoredRecord): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.hset(this.hashKey(collection), record.id, JSON.stringify(record));
    pipeline.zadd(this.tsKey(collection), record._timestamp, record.id);
    await pipeline.exec();
    await this.client.sadd(this.collectionsKey, collection);
  }

  async setBatch(collection: string, records: StoredRecord[]): Promise<void> {
    if (records.length === 0) return;

    const pipeline = this.client.pipeline();
    for (const record of records) {
      pipeline.hset(this.hashKey(collection), record.id, JSON.stringify(record));
      pipeline.zadd(this.tsKey(collection), record._timestamp, record.id);
    }
    await pipeline.exec();
    await this.client.sadd(this.collectionsKey, collection);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.client.hdel(this.hashKey(collection), id);
  }

  async getChangesSince(collection: string, since: number): Promise<StoredRecord[]> {
    // ZRANGEBYSCORE returns ids with timestamp > since
    const ids = await this.client.zrangebyscore(
      this.tsKey(collection),
      `(${since}`,
      '+inf'
    );
    if (ids.length === 0) return [];

    const records: StoredRecord[] = [];
    for (const id of ids) {
      const raw = await this.client.hget(this.hashKey(collection), id);
      if (raw) {
        records.push(JSON.parse(raw) as StoredRecord);
      }
    }
    return records;
  }

  async listCollections(): Promise<string[]> {
    return this.client.smembers(this.collectionsKey);
  }

  async clearCollection(collection: string): Promise<void> {
    await this.client.del(this.hashKey(collection), this.tsKey(collection));
    await this.client.srem(this.collectionsKey, collection);
  }

  async destroy(): Promise<void> {
    const collections = await this.listCollections();
    for (const collection of collections) {
      await this.clearCollection(collection);
    }
    await this.client.del(this.collectionsKey);
    await this.client.quit();
  }
}
