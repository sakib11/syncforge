import { describe, it, expect } from 'vitest';
import { computeDelta } from '../src/sync/delta';
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

function toMap(records: StoredRecord[]): Map<string, StoredRecord> {
  const map = new Map<string, StoredRecord>();
  for (const r of records) map.set(r.id, r);
  return map;
}

describe('computeDelta', () => {
  it('should classify new remote records as added', () => {
    const local = toMap([]);
    const remote = [rec('1'), rec('2')];
    const delta = computeDelta(local, remote);
    expect(delta.added).toHaveLength(2);
    expect(delta.updated).toHaveLength(0);
    expect(delta.deleted).toHaveLength(0);
    expect(delta.unchanged).toHaveLength(0);
  });

  it('should classify records with higher version/timestamp as updated', () => {
    const local = toMap([rec('1', { _version: 1, _timestamp: 1000 })]);
    const remote = [rec('1', { _version: 2, _timestamp: 2000 })];
    const delta = computeDelta(local, remote);
    expect(delta.updated).toHaveLength(1);
    expect(delta.added).toHaveLength(0);
  });

  it('should classify records with same version/timestamp as unchanged', () => {
    const local = toMap([rec('1', { _version: 1, _timestamp: 1000 })]);
    const remote = [rec('1', { _version: 1, _timestamp: 1000 })];
    const delta = computeDelta(local, remote);
    expect(delta.unchanged).toHaveLength(1);
    expect(delta.updated).toHaveLength(0);
  });

  it('should classify deleted remote records as deleted', () => {
    const local = toMap([rec('1', { _deleted: false })]);
    const remote = [rec('1', { _deleted: true, _timestamp: 2000 })];
    const delta = computeDelta(local, remote);
    expect(delta.deleted).toHaveLength(1);
  });

  it('should skip deleted remote records that do not exist locally', () => {
    const local = toMap([]);
    const remote = [rec('1', { _deleted: true })];
    const delta = computeDelta(local, remote);
    expect(delta.deleted).toHaveLength(0);
    expect(delta.unchanged).toHaveLength(1);
  });

  it('should handle mixed operations', () => {
    const local = toMap([
      rec('1', { _version: 1, _timestamp: 1000 }),
      rec('2', { _version: 1, _timestamp: 1000 }),
      rec('3', { _version: 1, _timestamp: 1000, _deleted: false }),
    ]);
    const remote = [
      rec('1', { _version: 1, _timestamp: 1000 }), // unchanged
      rec('2', { _version: 2, _timestamp: 2000 }), // updated
      rec('3', { _deleted: true, _timestamp: 2000 }), // deleted
      rec('4'), // added
    ];

    const delta = computeDelta(local, remote);
    expect(delta.unchanged).toHaveLength(1);
    expect(delta.updated).toHaveLength(1);
    expect(delta.deleted).toHaveLength(1);
    expect(delta.added).toHaveLength(1);
  });

  it('should detect update when only version is higher', () => {
    const local = toMap([rec('1', { _version: 1, _timestamp: 1000 })]);
    const remote = [rec('1', { _version: 3, _timestamp: 1000 })];
    const delta = computeDelta(local, remote);
    expect(delta.updated).toHaveLength(1);
  });
});
