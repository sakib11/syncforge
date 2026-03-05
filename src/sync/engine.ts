/**
 * syncforge
 * SyncEngine — the main public API for data synchronisation.
 *
 * Coordinates storage backends, conflict resolution, delta computation,
 * event emission, auto-sync timers, retry logic, and batch processing.
 */

import {
  StorageBackend,
  StoredRecord,
  SyncRecord,
  SyncEngineConfig,
  SyncEngineOptions,
  SyncResult,
  ConflictDetail,
} from '../types';
import { resolveConfig } from '../config';
import { SyncEventEmitter } from '../events';
import { createBackend } from '../backends';
import { computeDelta } from './delta';
import { resolveConflict } from './conflict';

export class SyncEngine {
  readonly config: SyncEngineConfig;
  readonly events: SyncEventEmitter;

  private backend: StorageBackend;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(options: SyncEngineOptions = {}) {
    this.config = resolveConfig(options);
    this.events = new SyncEventEmitter();
    this.backend = createBackend(this.config);

    if (this.config.autoSync) {
      this.startAutoSync();
    }
  }

  // ─── Public CRUD API ─────────────────────────────────────────────────────

  /**
   * Insert or update a record. The engine stamps internal metadata automatically.
   */
  async put(collection: string, record: SyncRecord): Promise<StoredRecord> {
    this.assertNotDestroyed();

    const existing = await this.backend.get(collection, record.id);
    const now = Date.now();

    const stored: StoredRecord = {
      ...record,
      _version: existing ? existing._version + 1 : 1,
      _timestamp: now,
      _deleted: false,
      _clientId: this.config.clientId!,
    };

    await this.backend.set(collection, stored);

    if (existing) {
      this.events.emit('record:updated', { collection, record: stored, previous: existing });
    } else {
      this.events.emit('record:added', { collection, record: stored });
    }

    return stored;
  }

  /**
   * Retrieve a record by collection and id.
   */
  async get(collection: string, id: string): Promise<StoredRecord | null> {
    this.assertNotDestroyed();
    return this.backend.get(collection, id);
  }

  /**
   * Retrieve all records in a collection.
   */
  async getAll(collection: string): Promise<StoredRecord[]> {
    this.assertNotDestroyed();
    return this.backend.getAll(collection);
  }

  /**
   * Soft-delete a record by marking it as `_deleted`.
   */
  async delete(collection: string, id: string): Promise<StoredRecord | null> {
    this.assertNotDestroyed();

    const existing = await this.backend.get(collection, id);
    if (!existing) return null;

    const deleted: StoredRecord = {
      ...existing,
      _version: existing._version + 1,
      _timestamp: Date.now(),
      _deleted: true,
      _clientId: this.config.clientId!,
    };

    await this.backend.set(collection, deleted);
    this.events.emit('record:deleted', { collection, record: deleted });
    return deleted;
  }

  /**
   * Get all records changed since a timestamp (for incremental sync).
   */
  async getChangesSince(collection: string, since: number): Promise<StoredRecord[]> {
    this.assertNotDestroyed();
    return this.backend.getChangesSince(collection, since);
  }

  // ─── Sync API ────────────────────────────────────────────────────────────

  /**
   * Synchronise a collection with a set of incoming remote records.
   *
   * This is the core synchronisation method. It:
   *   1. Computes deltas between local and remote records.
   *   2. Resolves conflicts using the configured strategy.
   *   3. Stores the merged results in batches.
   *   4. Emits events throughout the process.
   *
   * Supports retry logic: if the sync fails it will retry up to `maxRetries` times.
   */
  async sync(collection: string, remoteRecords: StoredRecord[]): Promise<SyncResult> {
    this.assertNotDestroyed();

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.syncOnce(collection, remoteRecords);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          // Exponential back-off: 100ms, 200ms, 400ms, …
          await this.sleep(100 * Math.pow(2, attempt));
        }
      }
    }

    // All retries exhausted
    this.events.emit('sync:error', {
      collection,
      error: lastError!,
      timestamp: Date.now(),
    });
    throw lastError;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Start the auto-sync timer.
   */
  startAutoSync(): void {
    if (this.autoSyncTimer) return;
    this.autoSyncTimer = setInterval(() => {
      // Auto-sync emits events but does not throw — errors are reported via events
      this.autoSyncTick().catch(() => {
        /* handled via events */
      });
    }, this.config.autoSyncInterval);
  }

  /**
   * Stop the auto-sync timer.
   */
  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  /**
   * Tear down the engine: stop auto-sync, destroy the backend, remove listeners.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.stopAutoSync();
    await this.backend.destroy();
    this.events.removeAllListeners();
    this.destroyed = true;
  }

  /**
   * Returns the underlying storage backend (useful for advanced use-cases).
   */
  getBackend(): StorageBackend {
    return this.backend;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Execute a single sync pass (no retries).
   */
  private async syncOnce(
    collection: string,
    remoteRecords: StoredRecord[]
  ): Promise<SyncResult> {
    const start = Date.now();

    this.events.emit('sync:start', {
      collection,
      recordCount: remoteRecords.length,
      timestamp: start,
    });

    // Build local record index
    const localRecords = await this.backend.getAll(collection);
    const localMap = new Map<string, StoredRecord>();
    for (const r of localRecords) {
      localMap.set(r.id, r);
    }

    // Compute deltas
    const delta = computeDelta(localMap, remoteRecords);

    const conflicts: ConflictDetail[] = [];
    const toStore: StoredRecord[] = [];

    // Process additions
    for (const record of delta.added) {
      toStore.push(record);
      this.events.emit('record:added', { collection, record });
    }

    // Process deletions
    for (const record of delta.deleted) {
      const local = localMap.get(record.id)!;
      const deletedRecord: StoredRecord = {
        ...local,
        _version: Math.max(local._version, record._version) + 1,
        _timestamp: record._timestamp,
        _deleted: true,
        _clientId: record._clientId,
      };
      toStore.push(deletedRecord);
      this.events.emit('record:deleted', { collection, record: deletedRecord });
    }

    // Process updates — these may involve conflicts
    for (const remote of delta.updated) {
      const local = localMap.get(remote.id);

      if (local && local._clientId !== remote._clientId) {
        // Genuine conflict — both sides have edits from different clients
        const conflict = resolveConflict(
          collection,
          local,
          remote,
          this.config.conflictStrategy
        );
        conflicts.push(conflict);
        toStore.push(conflict.resolvedRecord);
        this.events.emit('conflict', conflict);
        this.events.emit('record:updated', {
          collection,
          record: conflict.resolvedRecord,
          previous: local,
        });
      } else {
        // No conflict — remote is simply newer
        toStore.push(remote);
        if (local) {
          this.events.emit('record:updated', { collection, record: remote, previous: local });
        }
      }
    }

    // Persist in batches
    await this.storeBatched(collection, toStore);

    const result: SyncResult = {
      collection,
      added: delta.added.length,
      updated: delta.updated.length,
      deleted: delta.deleted.length,
      conflicts,
      timestamp: Date.now(),
      duration: Date.now() - start,
    };

    this.events.emit('sync:success', result);
    return result;
  }

  /**
   * Store records in batches of `config.batchSize`.
   */
  private async storeBatched(collection: string, records: StoredRecord[]): Promise<void> {
    const { batchSize } = this.config;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await this.backend.setBatch(collection, batch);
    }
  }

  /**
   * A single auto-sync tick. Lists all collections and emits a lightweight
   * sync event. In a real-world scenario this would call out to a remote
   * server; here we simply signal that a sync window is available.
   */
  private async autoSyncTick(): Promise<void> {
    // Auto-sync is a hook — consumers listen to sync:start and provide remote
    // records via engine.sync(). Here we just emit an event per collection.
    try {
      const collections = await this.backend.listCollections();
      for (const collection of collections) {
        this.events.emit('sync:start', {
          collection,
          recordCount: 0,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.events.emit('sync:error', {
        collection: '*',
        error,
        timestamp: Date.now(),
      });
    }
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('[SyncForge] Engine has been destroyed.');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
