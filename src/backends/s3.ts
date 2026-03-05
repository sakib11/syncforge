/**
 * @sakib11/data-sync-engine
 * Amazon S3 storage backend.
 *
 * Stores records as individual JSON objects in S3 under the key pattern:
 *   `${prefix}/${collection}/${id}.json`
 *
 * A manifest object `${prefix}/${collection}/__manifest__.json` holds a list
 * of record ids and their timestamps for efficient `getChangesSince` queries.
 *
 * Requires `@aws-sdk/client-s3` ^3.0.0 to be installed.
 */

import { StorageBackend, StoredRecord, S3Config } from '../types';

// Minimal S3 client interface so we don't require the type package at compile time
interface S3Client {
  send(command: unknown): Promise<unknown>;
}

interface S3CommandCtor {
  new (input: Record<string, unknown>): unknown;
}

interface ManifestEntry {
  id: string;
  timestamp: number;
}

export class S3Backend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  // AWS SDK command constructors — loaded dynamically
  private GetObjectCommand: S3CommandCtor;
  private PutObjectCommand: S3CommandCtor;
  private DeleteObjectCommand: S3CommandCtor;
  private ListObjectsV2Command: S3CommandCtor;

  constructor(config: S3Config) {
    let sdk: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      sdk = require('@aws-sdk/client-s3') as Record<string, unknown>;
    } catch {
      throw new Error(
        '[DataSyncEngine] S3 backend requires the "@aws-sdk/client-s3" package. ' +
          'Install it with: npm install @aws-sdk/client-s3'
      );
    }

    const S3ClientCtor = sdk.S3Client as new (cfg: Record<string, unknown>) => S3Client;
    const clientConfig: Record<string, unknown> = {
      region: config.region,
    };
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true;
    }

    this.client = new S3ClientCtor(clientConfig);
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? 'dse';

    this.GetObjectCommand = sdk.GetObjectCommand as S3CommandCtor;
    this.PutObjectCommand = sdk.PutObjectCommand as S3CommandCtor;
    this.DeleteObjectCommand = sdk.DeleteObjectCommand as S3CommandCtor;
    this.ListObjectsV2Command = sdk.ListObjectsV2Command as S3CommandCtor;
  }

  private objectKey(collection: string, id: string): string {
    return `${this.prefix}/${collection}/${id}.json`;
  }

  private manifestKey(collection: string): string {
    return `${this.prefix}/${collection}/__manifest__.json`;
  }

  private collectionsManifestKey(): string {
    return `${this.prefix}/__collections__.json`;
  }

  // ─── Manifest helpers ──────────────────────────────────────────────────────

  private async getManifest(collection: string): Promise<ManifestEntry[]> {
    try {
      const body = await this.getObject(this.manifestKey(collection));
      return JSON.parse(body) as ManifestEntry[];
    } catch {
      return [];
    }
  }

  private async putManifest(collection: string, entries: ManifestEntry[]): Promise<void> {
    await this.putObject(this.manifestKey(collection), JSON.stringify(entries));
  }

  private async getCollectionsList(): Promise<string[]> {
    try {
      const body = await this.getObject(this.collectionsManifestKey());
      return JSON.parse(body) as string[];
    } catch {
      return [];
    }
  }

  private async putCollectionsList(collections: string[]): Promise<void> {
    await this.putObject(this.collectionsManifestKey(), JSON.stringify(collections));
  }

  // ─── Low-level S3 helpers ─────────────────────────────────────────────────

  private async getObject(key: string): Promise<string> {
    const command = new this.GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = (await this.client.send(command)) as {
      Body?: { transformToString(): Promise<string> };
    };
    if (!response.Body) {
      throw new Error(`Empty body for key ${key}`);
    }
    return response.Body.transformToString();
  }

  private async putObject(key: string, body: string): Promise<void> {
    const command = new this.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    });
    await this.client.send(command);
  }

  private async deleteObject(key: string): Promise<void> {
    const command = new this.DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.client.send(command);
  }

  // ─── StorageBackend interface ──────────────────────────────────────────────

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    try {
      const body = await this.getObject(this.objectKey(collection, id));
      return JSON.parse(body) as StoredRecord;
    } catch {
      return null;
    }
  }

  async getAll(collection: string): Promise<StoredRecord[]> {
    const manifest = await this.getManifest(collection);
    if (manifest.length === 0) return [];

    const records: StoredRecord[] = [];
    for (const entry of manifest) {
      const record = await this.get(collection, entry.id);
      if (record) records.push(record);
    }
    return records;
  }

  async set(collection: string, record: StoredRecord): Promise<void> {
    await this.putObject(this.objectKey(collection, record.id), JSON.stringify(record));

    // Update manifest
    const manifest = await this.getManifest(collection);
    const idx = manifest.findIndex((e) => e.id === record.id);
    const entry: ManifestEntry = { id: record.id, timestamp: record._timestamp };
    if (idx >= 0) {
      manifest[idx] = entry;
    } else {
      manifest.push(entry);
    }
    await this.putManifest(collection, manifest);

    // Track collection
    const collections = await this.getCollectionsList();
    if (!collections.includes(collection)) {
      collections.push(collection);
      await this.putCollectionsList(collections);
    }
  }

  async setBatch(collection: string, records: StoredRecord[]): Promise<void> {
    if (records.length === 0) return;

    // Write all record objects
    await Promise.all(
      records.map((r) =>
        this.putObject(this.objectKey(collection, r.id), JSON.stringify(r))
      )
    );

    // Update manifest
    const manifest = await this.getManifest(collection);
    for (const record of records) {
      const idx = manifest.findIndex((e) => e.id === record.id);
      const entry: ManifestEntry = { id: record.id, timestamp: record._timestamp };
      if (idx >= 0) {
        manifest[idx] = entry;
      } else {
        manifest.push(entry);
      }
    }
    await this.putManifest(collection, manifest);

    // Track collection
    const collections = await this.getCollectionsList();
    if (!collections.includes(collection)) {
      collections.push(collection);
      await this.putCollectionsList(collections);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.deleteObject(this.objectKey(collection, id));

    const manifest = await this.getManifest(collection);
    const updated = manifest.filter((e) => e.id !== id);
    await this.putManifest(collection, updated);
  }

  async getChangesSince(collection: string, since: number): Promise<StoredRecord[]> {
    const manifest = await this.getManifest(collection);
    const changed = manifest.filter((e) => e.timestamp > since);

    const records: StoredRecord[] = [];
    for (const entry of changed) {
      const record = await this.get(collection, entry.id);
      if (record) records.push(record);
    }
    return records;
  }

  async listCollections(): Promise<string[]> {
    return this.getCollectionsList();
  }

  async clearCollection(collection: string): Promise<void> {
    const manifest = await this.getManifest(collection);

    // Delete all record objects
    await Promise.all(
      manifest.map((e) => this.deleteObject(this.objectKey(collection, e.id)))
    );

    // Delete manifest
    try {
      await this.deleteObject(this.manifestKey(collection));
    } catch {
      // ignore
    }

    // Update collections list
    const collections = await this.getCollectionsList();
    const updated = collections.filter((c) => c !== collection);
    await this.putCollectionsList(updated);
  }

  async destroy(): Promise<void> {
    const collections = await this.listCollections();
    for (const collection of collections) {
      await this.clearCollection(collection);
    }
    try {
      await this.deleteObject(this.collectionsManifestKey());
    } catch {
      // ignore
    }
  }
}
