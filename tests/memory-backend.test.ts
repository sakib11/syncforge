import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBackend } from '../src/backends/memory';
import { StoredRecord } from '../src/types';

function rec(id: string, overrides?: Partial<StoredRecord>): StoredRecord {
  return {
    id,
    _version: 1,
    _timestamp: 1000,
    _deleted: false,
    _clientId: 'client_a',
    ...overrides,
  };
}

describe('MemoryBackend', () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  describe('get / set', () => {
    it('should return null for non-existent records', async () => {
      expect(await backend.get('users', '1')).toBeNull();
    });

    it('should store and retrieve a record', async () => {
      const r = rec('1', { name: 'Alice' } as Partial<StoredRecord>);
      await backend.set('users', r);
      const result = await backend.get('users', '1');
      expect(result).toEqual(r);
    });

    it('should store a copy (not a reference)', async () => {
      const r = rec('1');
      await backend.set('users', r);
      r._version = 999;
      const result = await backend.get('users', '1');
      expect(result!._version).toBe(1);
    });
  });

  describe('getAll', () => {
    it('should return empty array for unknown collection', async () => {
      expect(await backend.getAll('unknown')).toEqual([]);
    });

    it('should return all records in a collection', async () => {
      await backend.set('users', rec('1'));
      await backend.set('users', rec('2'));
      await backend.set('posts', rec('3'));
      const users = await backend.getAll('users');
      expect(users).toHaveLength(2);
    });
  });

  describe('setBatch', () => {
    it('should store multiple records at once', async () => {
      await backend.setBatch('users', [rec('1'), rec('2'), rec('3')]);
      expect(await backend.getAll('users')).toHaveLength(3);
    });
  });

  describe('delete', () => {
    it('should remove a record', async () => {
      await backend.set('users', rec('1'));
      await backend.delete('users', '1');
      expect(await backend.get('users', '1')).toBeNull();
    });

    it('should not throw when deleting non-existent record', async () => {
      await expect(backend.delete('users', 'nope')).resolves.not.toThrow();
    });
  });

  describe('getChangesSince', () => {
    it('should return records with timestamp > since', async () => {
      await backend.set('users', rec('1', { _timestamp: 1000 }));
      await backend.set('users', rec('2', { _timestamp: 2000 }));
      await backend.set('users', rec('3', { _timestamp: 3000 }));

      const changes = await backend.getChangesSince('users', 1500);
      expect(changes).toHaveLength(2);
      expect(changes.map((r) => r.id).sort()).toEqual(['2', '3']);
    });

    it('should return empty for unknown collection', async () => {
      expect(await backend.getChangesSince('unknown', 0)).toEqual([]);
    });
  });

  describe('listCollections', () => {
    it('should return empty array when no data', async () => {
      expect(await backend.listCollections()).toEqual([]);
    });

    it('should list all collection names', async () => {
      await backend.set('users', rec('1'));
      await backend.set('posts', rec('2'));
      const cols = await backend.listCollections();
      expect(cols.sort()).toEqual(['posts', 'users']);
    });
  });

  describe('clearCollection', () => {
    it('should remove all records in a collection', async () => {
      await backend.set('users', rec('1'));
      await backend.set('users', rec('2'));
      await backend.clearCollection('users');
      expect(await backend.getAll('users')).toEqual([]);
      expect(await backend.listCollections()).not.toContain('users');
    });
  });

  describe('destroy', () => {
    it('should clear all data', async () => {
      await backend.set('users', rec('1'));
      await backend.set('posts', rec('2'));
      await backend.destroy();
      expect(await backend.listCollections()).toEqual([]);
    });
  });
});
