/**
 * @sakib11/data-sync-engine
 * Filesystem storage backend.
 *
 * Stores each collection as a directory and each record as a JSON file.
 * Suitable for single-process scenarios, local persistence, and embedded use.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StorageBackend, StoredRecord } from '../types';

export class FilesystemBackend implements StorageBackend {
  private baseDir: string;

  constructor(directory: string) {
    this.baseDir = directory;
  }

  private collectionDir(collection: string): string {
    return path.join(this.baseDir, collection);
  }

  private recordPath(collection: string, id: string): string {
    // Sanitise the id so it is safe to use as a filename
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.collectionDir(collection), `${safeId}.json`);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    const filePath = this.recordPath(collection, id);
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as StoredRecord;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async getAll(collection: string): Promise<StoredRecord[]> {
    const dir = this.collectionDir(collection);
    try {
      const files = await fs.promises.readdir(dir);
      const records: StoredRecord[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const data = await fs.promises.readFile(path.join(dir, file), 'utf-8');
        records.push(JSON.parse(data) as StoredRecord);
      }
      return records;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async set(collection: string, record: StoredRecord): Promise<void> {
    await this.ensureDir(this.collectionDir(collection));
    const filePath = this.recordPath(collection, record.id);
    await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
  }

  async setBatch(collection: string, records: StoredRecord[]): Promise<void> {
    await this.ensureDir(this.collectionDir(collection));
    await Promise.all(
      records.map((record) => {
        const filePath = this.recordPath(collection, record.id);
        return fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
      })
    );
  }

  async delete(collection: string, id: string): Promise<void> {
    const filePath = this.recordPath(collection, id);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async getChangesSince(collection: string, since: number): Promise<StoredRecord[]> {
    const all = await this.getAll(collection);
    return all.filter((r) => r._timestamp > since);
  }

  async listCollections(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async clearCollection(collection: string): Promise<void> {
    const dir = this.collectionDir(collection);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async destroy(): Promise<void> {
    // Only remove collection directories, not the base directory itself
    const collections = await this.listCollections();
    await Promise.all(collections.map((c) => this.clearCollection(c)));
  }
}
