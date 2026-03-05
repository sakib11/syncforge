import { describe, it, expect } from 'vitest';
import { LWWMap } from '../src/crdt/lww-map';
import { StoredRecord } from '../src/types';

function makeRecord(overrides: Partial<StoredRecord> & { id: string }): StoredRecord {
  return {
    _version: 1,
    _timestamp: 1000,
    _deleted: false,
    _clientId: 'client_a',
    ...overrides,
  };
}

describe('LWWMap', () => {
  it('should set and get values', () => {
    const map = new LWWMap();
    map.set('name', 'Alice', 1000, 'client_a');
    expect(map.get('name')).toBe('Alice');
  });

  it('should return undefined for missing keys', () => {
    const map = new LWWMap();
    expect(map.get('missing')).toBeUndefined();
  });

  it('should update a key with a higher timestamp', () => {
    const map = new LWWMap();
    map.set('name', 'Alice', 1000, 'client_a');
    map.set('name', 'Bob', 2000, 'client_b');
    expect(map.get('name')).toBe('Bob');
  });

  it('should not update a key with a lower timestamp', () => {
    const map = new LWWMap();
    map.set('name', 'Alice', 2000, 'client_a');
    map.set('name', 'Bob', 1000, 'client_b');
    expect(map.get('name')).toBe('Alice');
  });

  it('should merge states from another LWWMap', () => {
    const map1 = new LWWMap();
    map1.set('name', 'Alice', 1000, 'client_a');
    map1.set('age', 30, 1000, 'client_a');

    const map2 = new LWWMap();
    map2.set('name', 'Bob', 2000, 'client_b');
    map2.set('email', 'bob@test.com', 2000, 'client_b');

    map1.merge(map2.getState());

    expect(map1.get('name')).toBe('Bob'); // updated by map2
    expect(map1.get('age')).toBe(30); // only in map1
    expect(map1.get('email')).toBe('bob@test.com'); // added from map2
  });

  it('getState should return the full state', () => {
    const map = new LWWMap();
    map.set('x', 1, 1000, 'c1');
    map.set('y', 2, 2000, 'c2');
    const state = map.getState();
    expect(state.x).toEqual({ value: 1, timestamp: 1000, clientId: 'c1' });
    expect(state.y).toEqual({ value: 2, timestamp: 2000, clientId: 'c2' });
  });

  it('toRecord should return just the values', () => {
    const map = new LWWMap();
    map.set('x', 1, 1000, 'c1');
    map.set('y', 'hello', 2000, 'c2');
    expect(map.toRecord()).toEqual({ x: 1, y: 'hello' });
  });

  describe('fromRecord', () => {
    it('should create a map from a StoredRecord, excluding metadata', () => {
      const record = makeRecord({ id: '1', name: 'Alice', age: 30 });
      const map = LWWMap.fromRecord(record);
      expect(map.get('name')).toBe('Alice');
      expect(map.get('age')).toBe(30);
      expect(map.get('id')).toBeUndefined();
      expect(map.get('_version')).toBeUndefined();
    });
  });

  describe('mergeRecords', () => {
    it('should merge two records from different clients', () => {
      const local = makeRecord({
        id: '1',
        name: 'Alice',
        age: 30,
        _timestamp: 1000,
        _clientId: 'client_a',
        _version: 1,
      });
      const remote = makeRecord({
        id: '1',
        name: 'Bob',
        age: 30,
        email: 'bob@test.com',
        _timestamp: 2000,
        _clientId: 'client_b',
        _version: 2,
      });

      const { merged, conflictedFields } = LWWMap.mergeRecords(local, remote);

      expect(merged.id).toBe('1');
      expect(merged.name).toBe('Bob'); // remote wins (higher timestamp)
      expect(merged.email).toBe('bob@test.com'); // added from remote
      expect(merged._version).toBe(3); // max(1,2) + 1
      expect(merged._timestamp).toBe(2000);
      expect(conflictedFields).toContain('name');
    });

    it('should preserve both updates when different fields change', () => {
      const local = makeRecord({
        id: '1',
        name: 'Alice',
        age: 31,
        _timestamp: 2000,
        _clientId: 'client_a',
        _version: 2,
      });
      const remote = makeRecord({
        id: '1',
        name: 'Alice',
        age: 30,
        email: 'alice@test.com',
        _timestamp: 2000,
        _clientId: 'client_b',
        _version: 2,
      });

      const { merged, conflictedFields } = LWWMap.mergeRecords(local, remote);

      // age was different but both changed independently
      expect(merged.email).toBe('alice@test.com');
      expect(conflictedFields).toContain('age');
    });

    it('should handle both records being deleted', () => {
      const local = makeRecord({ id: '1', _deleted: true, _clientId: 'a' });
      const remote = makeRecord({ id: '1', _deleted: true, _clientId: 'b' });
      const { merged } = LWWMap.mergeRecords(local, remote);
      expect(merged._deleted).toBe(true);
    });

    it('should not mark as deleted when only one side is deleted', () => {
      const local = makeRecord({ id: '1', _deleted: false, _clientId: 'a' });
      const remote = makeRecord({ id: '1', _deleted: true, _clientId: 'b' });
      const { merged } = LWWMap.mergeRecords(local, remote);
      expect(merged._deleted).toBe(false);
    });
  });
});
