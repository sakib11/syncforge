import { describe, it, expect, afterEach } from 'vitest';
import { SyncEngine } from '../src/sync/engine';
import { StoredRecord } from '../src/types';

describe('Integration: multi-client sync', () => {
  let clientA: SyncEngine;
  let clientB: SyncEngine;

  afterEach(async () => {
    if (clientA) await clientA.destroy();
    if (clientB) await clientB.destroy();
  });

  it('should sync records between two clients', async () => {
    clientA = new SyncEngine({ clientId: 'client_a' });
    clientB = new SyncEngine({ clientId: 'client_b' });

    // Client A creates records
    await clientA.put('users', { id: '1', name: 'Alice' });
    await clientA.put('users', { id: '2', name: 'Bob' });

    // Get A's records
    const aRecords = await clientA.getAll('users');

    // Sync A's records into B
    const result = await clientB.sync('users', aRecords);
    expect(result.added).toBe(2);

    // B should now have the same records
    const bRecords = await clientB.getAll('users');
    expect(bRecords).toHaveLength(2);
    expect(bRecords.find((r) => r.id === '1')!.name).toBe('Alice');
    expect(bRecords.find((r) => r.id === '2')!.name).toBe('Bob');
  });

  it('should handle concurrent edits with timestamp strategy', async () => {
    clientA = new SyncEngine({ clientId: 'client_a', conflictStrategy: 'timestamp' });
    clientB = new SyncEngine({ clientId: 'client_b', conflictStrategy: 'timestamp' });

    // Both clients start with the same record
    const initial: StoredRecord = {
      id: '1',
      name: 'Alice',
      _version: 1,
      _timestamp: 1000,
      _deleted: false,
      _clientId: 'original',
    };
    await clientA.getBackend().set('users', initial);
    await clientB.getBackend().set('users', { ...initial });

    // Client A updates name
    await clientA.put('users', { id: '1', name: 'Alice A' });

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    // Client B updates name (later timestamp)
    await clientB.put('users', { id: '1', name: 'Alice B' });

    // Get B's version and sync into A
    const bRecord = await clientB.get('users', '1');
    const result = await clientA.sync('users', [bRecord!]);

    // B's edit should win (higher timestamp)
    const resolved = await clientA.get('users', '1');
    expect(resolved!.name).toBe('Alice B');
    expect(result.conflicts).toHaveLength(1);
  });

  it('should handle concurrent edits with crdt strategy (field-level merge)', async () => {
    clientA = new SyncEngine({ clientId: 'client_a', conflictStrategy: 'crdt' });
    clientB = new SyncEngine({ clientId: 'client_b', conflictStrategy: 'crdt' });

    // Both start with the same record
    const initial: StoredRecord = {
      id: '1',
      name: 'Alice',
      age: 30,
      email: 'alice@old.com',
      _version: 1,
      _timestamp: 1000,
      _deleted: false,
      _clientId: 'original',
    };
    await clientA.getBackend().set('users', { ...initial });
    await clientB.getBackend().set('users', { ...initial });

    // Client A updates age
    await clientA.put('users', { id: '1', name: 'Alice', age: 31, email: 'alice@old.com' });

    await new Promise((r) => setTimeout(r, 10));

    // Client B updates email
    await clientB.put('users', { id: '1', name: 'Alice', age: 30, email: 'alice@new.com' });

    // Get B's version and sync into A
    const bRecord = await clientB.get('users', '1');
    await clientA.sync('users', [bRecord!]);

    // Both changes should be preserved in the CRDT merge
    const resolved = await clientA.get('users', '1');
    expect(resolved!.name).toBe('Alice');
    expect(resolved!.email).toBe('alice@new.com'); // B's change (later timestamp)
  });

  it('should handle deletions across clients', async () => {
    clientA = new SyncEngine({ clientId: 'client_a' });
    clientB = new SyncEngine({ clientId: 'client_b' });

    // Client A creates a record
    await clientA.put('users', { id: '1', name: 'Alice' });
    const aRecords = await clientA.getAll('users');

    // Sync to B
    await clientB.sync('users', aRecords);

    // Client A deletes the record
    await clientA.delete('users', '1');
    const aAfterDelete = await clientA.getAll('users');

    // Sync deletion to B
    const result = await clientB.sync('users', aAfterDelete);
    expect(result.deleted).toBe(1);

    const bRecord = await clientB.get('users', '1');
    expect(bRecord!._deleted).toBe(true);
  });

  it('should support incremental sync with getChangesSince', async () => {
    clientA = new SyncEngine({ clientId: 'client_a' });
    clientB = new SyncEngine({ clientId: 'client_b' });

    // Client A creates some records
    const r1 = await clientA.put('users', { id: '1', name: 'Alice' });

    await new Promise((r) => setTimeout(r, 10));
    const checkpoint = Date.now();
    await new Promise((r) => setTimeout(r, 10));

    await clientA.put('users', { id: '2', name: 'Bob' });
    await clientA.put('users', { id: '3', name: 'Charlie' });

    // Get only changes since checkpoint
    const changes = await clientA.getChangesSince('users', checkpoint);
    expect(changes).toHaveLength(2);

    // Sync only the changes to B
    const result = await clientB.sync('users', changes);
    expect(result.added).toBe(2);

    const bAll = await clientB.getAll('users');
    expect(bAll).toHaveLength(2); // Only 2 and 3, not 1
  });

  it('should handle batch processing for large syncs', async () => {
    clientA = new SyncEngine({ clientId: 'client_a', batchSize: 10 });

    // Create 25 records
    const records: StoredRecord[] = [];
    for (let i = 0; i < 25; i++) {
      records.push({
        id: `rec_${i}`,
        value: i,
        _version: 1,
        _timestamp: 1000 + i,
        _deleted: false,
        _clientId: 'remote',
      });
    }

    const result = await clientA.sync('users', records);
    expect(result.added).toBe(25);

    const all = await clientA.getAll('users');
    expect(all).toHaveLength(25);
  });
});
