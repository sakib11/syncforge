/**
 * syncforge
 * In-memory storage backend.
 *
 * Data is stored in nested Maps and does not survive process restarts.
 * Ideal for testing, prototyping, and short-lived sync sessions.
 */

import { StorageBackend, StoredRecord } from '../types';

export class MemoryBackend implements StorageBackend {
  private store: Map<string, Map<string, StoredRecord>> = new Map();

  async get(collection: string, id: string): Promise<StoredRecord | null> {
    const col = this.store.get(collection);
    if (!col) return null;
    return col.get(id) ?? null;
  }

  async getAll(collection: string): Promise<StoredRecord[]> {
    const col = this.store.get(collection);
    if (!col) return [];
    return Array.from(col.values());
  }

  async set(collection: string, record: StoredRecord): Promise<void> {
    let col = this.store.get(collection);
    if (!col) {
      col = new Map();
      this.store.set(collection, col);
    }
    col.set(record.id, { ...record });
  }

  async setBatch(collection: string, records: StoredRecord[]): Promise<void> {
    let col = this.store.get(collection);
    if (!col) {
      col = new Map();
      this.store.set(collection, col);
    }
    for (const record of records) {
      col.set(record.id, { ...record });
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    const col = this.store.get(collection);
    if (col) {
      col.delete(id);
      if (col.size === 0) {
        this.store.delete(collection);
      }
    }
  }

  async getChangesSince(collection: string, since: number): Promise<StoredRecord[]> {
    const col = this.store.get(collection);
    if (!col) return [];
    return Array.from(col.values()).filter((r) => r._timestamp > since);
  }

  async listCollections(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async clearCollection(collection: string): Promise<void> {
    this.store.delete(collection);
  }

  async destroy(): Promise<void> {
    this.store.clear();
  }
}
