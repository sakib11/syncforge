import { describe, it, expect } from 'vitest';
import { resolveConflict } from '../src/sync/conflict';
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

describe('resolveConflict', () => {
  describe('timestamp strategy', () => {
    it('should pick the remote record when it has a higher timestamp', () => {
      const local = rec('1', { name: 'Alice', _timestamp: 1000, _clientId: 'a', _version: 1 });
      const remote = rec('1', { name: 'Bob', _timestamp: 2000, _clientId: 'b', _version: 1 });
      const result = resolveConflict('users', local, remote, 'timestamp');
      expect(result.resolvedRecord.name).toBe('Bob');
      expect(result.resolvedRecord._version).toBe(2); // max(1,1)+1
      expect(result.strategy).toBe('timestamp');
    });

    it('should pick the local record when it has a higher timestamp', () => {
      const local = rec('1', { name: 'Alice', _timestamp: 2000, _clientId: 'a', _version: 2 });
      const remote = rec('1', { name: 'Bob', _timestamp: 1000, _clientId: 'b', _version: 1 });
      const result = resolveConflict('users', local, remote, 'timestamp');
      expect(result.resolvedRecord.name).toBe('Alice');
      expect(result.resolvedRecord._version).toBe(3); // max(2,1)+1
    });

    it('should break timestamp ties by clientId (lexicographically greater wins)', () => {
      const local = rec('1', { name: 'Alice', _timestamp: 1000, _clientId: 'a', _version: 1 });
      const remote = rec('1', { name: 'Bob', _timestamp: 1000, _clientId: 'b', _version: 1 });
      const result = resolveConflict('users', local, remote, 'timestamp');
      // 'b' > 'a' → remote wins
      expect(result.resolvedRecord.name).toBe('Bob');
    });

    it('should pick local when clientId is greater on tie', () => {
      const local = rec('1', { name: 'Alice', _timestamp: 1000, _clientId: 'z', _version: 1 });
      const remote = rec('1', { name: 'Bob', _timestamp: 1000, _clientId: 'a', _version: 1 });
      const result = resolveConflict('users', local, remote, 'timestamp');
      expect(result.resolvedRecord.name).toBe('Alice');
    });

    it('should include record metadata in ConflictDetail', () => {
      const local = rec('1', { _timestamp: 1000, _clientId: 'a' });
      const remote = rec('1', { _timestamp: 2000, _clientId: 'b' });
      const result = resolveConflict('users', local, remote, 'timestamp');
      expect(result.recordId).toBe('1');
      expect(result.collection).toBe('users');
      expect(result.localRecord).toBe(local);
      expect(result.remoteRecord).toBe(remote);
    });
  });

  describe('crdt strategy', () => {
    it('should merge at field level', () => {
      const local = rec('1', {
        name: 'Alice',
        age: 31,
        _timestamp: 2000,
        _clientId: 'a',
        _version: 2,
      });
      const remote = rec('1', {
        name: 'Alice',
        age: 30,
        email: 'alice@test.com',
        _timestamp: 2000,
        _clientId: 'b',
        _version: 2,
      });

      const result = resolveConflict('users', local, remote, 'crdt');
      expect(result.strategy).toBe('crdt');
      expect(result.resolvedRecord.email).toBe('alice@test.com');
      expect(result.resolvedRecord._version).toBe(3);
    });

    it('should report conflicted fields', () => {
      const local = rec('1', {
        name: 'Alice',
        _timestamp: 1000,
        _clientId: 'a',
        _version: 1,
      });
      const remote = rec('1', {
        name: 'Bob',
        _timestamp: 2000,
        _clientId: 'b',
        _version: 1,
      });

      const result = resolveConflict('users', local, remote, 'crdt');
      expect(result.fieldsConflicted).toContain('name');
    });

    it('should not have fieldsConflicted when there are no field conflicts', () => {
      const local = rec('1', {
        name: 'Alice',
        _timestamp: 1000,
        _clientId: 'a',
        _version: 1,
      });
      const remote = rec('1', {
        name: 'Alice',
        email: 'alice@test.com',
        _timestamp: 2000,
        _clientId: 'b',
        _version: 1,
      });

      const result = resolveConflict('users', local, remote, 'crdt');
      expect(result.fieldsConflicted).toBeUndefined();
    });
  });
});
