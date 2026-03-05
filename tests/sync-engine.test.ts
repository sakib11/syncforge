import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncEngine } from '../src/sync/engine';
import { StoredRecord } from '../src/types';

function rec(id: string, overrides?: Partial<StoredRecord>): StoredRecord {
  return {
    id,
    _version: 1,
    _timestamp: 1000,
    _deleted: false,
    _clientId: 'remote_client',
    ...overrides,
  };
}

describe('SyncEngine', () => {
  let engine: SyncEngine;

  beforeEach(() => {
    engine = new SyncEngine({ clientId: 'test_client' });
  });

  afterEach(async () => {
    await engine.destroy();
  });

  // ─── CRUD ──────────────────────────────────────────────────────────────

  describe('put', () => {
    it('should store a new record with metadata', async () => {
      const result = await engine.put('users', { id: '1', name: 'Alice' });
      expect(result.id).toBe('1');
      expect(result.name).toBe('Alice');
      expect(result._version).toBe(1);
      expect(result._deleted).toBe(false);
      expect(result._clientId).toBe('test_client');
      expect(result._timestamp).toBeGreaterThan(0);
    });

    it('should increment version on update', async () => {
      await engine.put('users', { id: '1', name: 'Alice' });
      const updated = await engine.put('users', { id: '1', name: 'Bob' });
      expect(updated._version).toBe(2);
      expect(updated.name).toBe('Bob');
    });

    it('should emit record:added for new records', async () => {
      const handler = vi.fn();
      engine.events.on('record:added', handler);
      await engine.put('users', { id: '1', name: 'Alice' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit record:updated for existing records', async () => {
      const handler = vi.fn();
      engine.events.on('record:updated', handler);
      await engine.put('users', { id: '1', name: 'Alice' });
      await engine.put('users', { id: '1', name: 'Bob' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].previous.name).toBe('Alice');
    });
  });

  describe('get', () => {
    it('should return null for non-existent records', async () => {
      expect(await engine.get('users', '1')).toBeNull();
    });

    it('should return stored records', async () => {
      await engine.put('users', { id: '1', name: 'Alice' });
      const result = await engine.get('users', '1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Alice');
    });
  });

  describe('getAll', () => {
    it('should return all records in a collection', async () => {
      await engine.put('users', { id: '1', name: 'Alice' });
      await engine.put('users', { id: '2', name: 'Bob' });
      const all = await engine.getAll('users');
      expect(all).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should soft-delete a record', async () => {
      await engine.put('users', { id: '1', name: 'Alice' });
      const deleted = await engine.delete('users', '1');
      expect(deleted).not.toBeNull();
      expect(deleted!._deleted).toBe(true);
      expect(deleted!._version).toBe(2);
    });

    it('should return null when deleting non-existent record', async () => {
      const result = await engine.delete('users', 'nope');
      expect(result).toBeNull();
    });

    it('should emit record:deleted', async () => {
      const handler = vi.fn();
      engine.events.on('record:deleted', handler);
      await engine.put('users', { id: '1', name: 'Alice' });
      await engine.delete('users', '1');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('getChangesSince', () => {
    it('should return records changed after a timestamp', async () => {
      const r1 = await engine.put('users', { id: '1', name: 'Alice' });
      // Ensure a time gap
      await new Promise((r) => setTimeout(r, 10));
      const r2 = await engine.put('users', { id: '2', name: 'Bob' });
      const changes = await engine.getChangesSince('users', r1._timestamp);
      expect(changes).toHaveLength(1);
      expect(changes[0].id).toBe('2');
    });
  });

  // ─── Sync ──────────────────────────────────────────────────────────────

  describe('sync', () => {
    it('should add new remote records', async () => {
      const result = await engine.sync('users', [
        rec('1', { name: 'Alice' }),
        rec('2', { name: 'Bob' }),
      ]);
      expect(result.added).toBe(2);
      expect(result.collection).toBe('users');
      const all = await engine.getAll('users');
      expect(all).toHaveLength(2);
    });

    it('should update records when remote is newer', async () => {
      await engine.put('users', { id: '1', name: 'Alice' });
      const local = await engine.get('users', '1');

      const result = await engine.sync('users', [
        rec('1', {
          name: 'Alice Updated',
          _version: 5,
          _timestamp: Date.now() + 10000,
          _clientId: 'remote',
        }),
      ]);
      expect(result.updated).toBe(1);
      const updated = await engine.get('users', '1');
      expect(updated!.name).toBe('Alice Updated');
    });

    it('should handle remote deletions', async () => {
      await engine.put('users', { id: '1', name: 'Alice' });

      const result = await engine.sync('users', [
        rec('1', { _deleted: true, _timestamp: Date.now() + 10000, _version: 5 }),
      ]);
      expect(result.deleted).toBe(1);
      const record = await engine.get('users', '1');
      expect(record!._deleted).toBe(true);
    });

    it('should detect and resolve conflicts (timestamp strategy)', async () => {
      // Put a local record
      await engine.put('users', { id: '1', name: 'Local' });

      const conflictHandler = vi.fn();
      engine.events.on('conflict', conflictHandler);

      // Sync a remote record from a different client with higher timestamp
      const result = await engine.sync('users', [
        rec('1', {
          name: 'Remote',
          _timestamp: Date.now() + 10000,
          _clientId: 'other_client',
          _version: 2,
        }),
      ]);

      expect(result.conflicts).toHaveLength(1);
      expect(conflictHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit sync:start and sync:success', async () => {
      const startHandler = vi.fn();
      const successHandler = vi.fn();
      engine.events.on('sync:start', startHandler);
      engine.events.on('sync:success', successHandler);

      await engine.sync('users', [rec('1')]);

      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
      expect(successHandler.mock.calls[0][0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should process empty remote set without errors', async () => {
      const result = await engine.sync('users', []);
      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
    });
  });

  // ─── CRDT sync ────────────────────────────────────────────────────────

  describe('sync with crdt strategy', () => {
    let crdtEngine: SyncEngine;

    beforeEach(() => {
      crdtEngine = new SyncEngine({
        clientId: 'test_client',
        conflictStrategy: 'crdt',
      });
    });

    afterEach(async () => {
      await crdtEngine.destroy();
    });

    it('should merge fields from different clients', async () => {
      await crdtEngine.put('users', { id: '1', name: 'Alice', age: 30 });

      const result = await crdtEngine.sync('users', [
        rec('1', {
          name: 'Alice',
          age: 30,
          email: 'alice@test.com',
          _timestamp: Date.now() + 10000,
          _clientId: 'other_client',
          _version: 2,
        }),
      ]);

      const record = await crdtEngine.get('users', '1');
      expect(record!.email).toBe('alice@test.com');
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should prevent further operations after destroy', async () => {
      await engine.destroy();
      await expect(engine.put('users', { id: '1' })).rejects.toThrow(/destroyed/);
    });

    it('should be idempotent', async () => {
      await engine.destroy();
      await expect(engine.destroy()).resolves.not.toThrow();
    });
  });

  describe('auto-sync', () => {
    it('should start and stop auto-sync', async () => {
      const autoEngine = new SyncEngine({
        clientId: 'auto_client',
        autoSync: true,
        autoSyncInterval: 1000,
      });
      // Just verify no error on lifecycle
      autoEngine.stopAutoSync();
      await autoEngine.destroy();
    });
  });

  describe('getBackend', () => {
    it('should return the storage backend', () => {
      const backend = engine.getBackend();
      expect(backend).toBeDefined();
      expect(typeof backend.get).toBe('function');
    });
  });
});
