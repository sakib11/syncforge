# syncforge

A TypeScript library for incremental and conflict-free data synchronization across multiple clients or databases. Supports CRDTs, timestamp-based merges, and offline-first workflows.

## Features

- **Pluggable storage backends** -- memory, filesystem, Redis, and Amazon S3
- **Two conflict resolution strategies** -- timestamp (last-writer-wins) and CRDT (field-level merge)
- **Incremental sync** -- only transfer records that changed since the last sync
- **Batch processing** -- large sync operations are chunked automatically
- **Retry with exponential back-off** -- failed syncs retry up to a configurable limit
- **Auto-sync timer** -- optional periodic sync on a configurable interval
- **Typed event system** -- subscribe to sync lifecycle, conflict, and record-level events
- **Offline-first** -- write locally, sync when connectivity is available
- **Zero required dependencies** -- Redis and S3 backends use optional peer dependencies

## When to Use

This library is a **data synchronization layer**, not a database or UI framework. It runs anywhere Node.js runs -- frontend, backend, edge, or embedded. The core problem it solves is: **multiple independent writers need to converge to a consistent state**.

### Offline-First Mobile / Desktop Apps

Users work without connectivity and sync when back online. The engine queues writes locally and merges seamlessly on reconnect.

**Context:** A field-service app where technicians inspect equipment at remote sites with no cell coverage. They log findings on a tablet, and everything syncs to the company server when they return to the office.

```ts
import { SyncEngine } from 'syncforge';

// On the tablet -- works offline with filesystem persistence
const tablet = new SyncEngine({
  clientId: 'technician-42',
  backend: 'filesystem',
  filesystemConfig: { directory: './local-data' },
  conflictStrategy: 'crdt',
});

// Technician logs an inspection offline
await tablet.put('inspections', {
  id: 'insp-001',
  equipmentId: 'pump-7',
  status: 'needs-repair',
  notes: 'Bearing noise detected',
});

// Later, back at the office -- push changes to the server
const changes = await tablet.getChangesSince('inspections', lastSyncTimestamp);
const response = await fetch('/api/sync/inspections', {
  method: 'POST',
  body: JSON.stringify(changes),
});
const serverRecords = await response.json();
await tablet.sync('inspections', serverRecords);
```

### Multi-Device Sync

The same user edits data on multiple devices. Changes made on any device propagate to all others.

**Context:** A note-taking app where a user drafts notes on their phone during a commute and continues editing on their laptop at home.

```ts
// Phone instance
const phone = new SyncEngine({ clientId: 'phone', conflictStrategy: 'crdt' });
await phone.put('notes', { id: 'n1', title: 'Meeting Notes', body: 'Discuss Q3 targets' });

// Laptop instance
const laptop = new SyncEngine({ clientId: 'laptop', conflictStrategy: 'crdt' });

// Sync phone → laptop
const phoneRecords = await phone.getAll('notes');
await laptop.sync('notes', phoneRecords);

// User edits title on laptop, body on phone (different fields, no conflict)
await laptop.put('notes', { id: 'n1', title: 'Q3 Planning Notes', body: 'Discuss Q3 targets' });
await phone.put('notes', { id: 'n1', title: 'Meeting Notes', body: 'Discuss Q3 targets\n- Revenue goals' });

// Sync both ways -- CRDT preserves both field changes
const laptopRecords = await laptop.getAll('notes');
await phone.sync('notes', laptopRecords);
const updatedPhone = await phone.getAll('notes');
await laptop.sync('notes', updatedPhone);

// Both devices now have:
//   title: 'Q3 Planning Notes'  (from laptop -- higher timestamp)
//   body:  'Discuss Q3 targets\n- Revenue goals'  (from phone -- higher timestamp)
```

### Collaborative Record Editing

Multiple users on a team edit shared records concurrently. The CRDT strategy ensures edits to different fields never overwrite each other.

**Context:** A shared project management board where one team member updates a task's status while another adds an assignee at the same time.

```ts
const alice = new SyncEngine({ clientId: 'alice', conflictStrategy: 'crdt' });
const bob = new SyncEngine({ clientId: 'bob', conflictStrategy: 'crdt' });

// Both start with the same task (synced earlier)
const task = { id: 'task-1', title: 'Deploy v2', status: 'in-progress', assignee: 'alice' };
await alice.getBackend().set('tasks', { ...task, _version: 1, _timestamp: 1000, _deleted: false, _clientId: 'seed' });
await bob.getBackend().set('tasks', { ...task, _version: 1, _timestamp: 1000, _deleted: false, _clientId: 'seed' });

// Alice marks the task done
await alice.put('tasks', { id: 'task-1', title: 'Deploy v2', status: 'done', assignee: 'alice' });

// Bob reassigns it (concurrently, before seeing Alice's change)
await bob.put('tasks', { id: 'task-1', title: 'Deploy v2', status: 'in-progress', assignee: 'bob' });

// Sync Bob's changes into Alice
const bobRecords = await bob.getAll('tasks');
const result = await alice.sync('tasks', bobRecords);

// CRDT merge result:
//   status: 'done' or 'in-progress' (whichever had the later timestamp wins)
//   assignee: 'bob' (Bob's timestamp is later for this field)
//   Both edits are tracked in result.conflicts[0].fieldsConflicted
console.log(`Conflicts resolved: ${result.conflicts.length}`);
```

### Edge / IoT Data Collection

Devices at the edge collect data locally and batch-sync to a central store on a schedule.

**Context:** Temperature sensors in a warehouse write readings to the local filesystem every second. An hourly cron job syncs the accumulated data to S3 for long-term storage.

```ts
// On the edge device -- collect readings locally
const sensor = new SyncEngine({
  clientId: 'sensor-warehouse-3',
  backend: 'filesystem',
  filesystemConfig: { directory: '/var/sensor-data' },
});

// Runs every second
async function recordReading(temperature: number) {
  await sensor.put('readings', {
    id: `r-${Date.now()}`,
    temperature,
    location: 'warehouse-3',
  });
}

// Hourly cron job: push to the central S3 store
async function syncToCloud(centralEngine: SyncEngine) {
  const changes = await sensor.getChangesSince('readings', lastSyncTimestamp);
  if (changes.length > 0) {
    await centralEngine.sync('readings', changes);
    lastSyncTimestamp = Date.now();
    console.log(`Synced ${changes.length} readings to cloud`);
  }
}
```

### Microservice Replication

Backend services in different regions each maintain a local cache and periodically reconcile with a shared data store.

**Context:** A product catalog API runs in US-East and EU-West. Each region has a Redis cache for low-latency reads. Changes are synced bidirectionally every 30 seconds so both regions converge.

```ts
// US-East service
const usEast = new SyncEngine({
  clientId: 'us-east-1',
  backend: 'redis',
  redisConfig: { host: 'redis-us-east.internal', port: 6379 },
  autoSync: true,
  autoSyncInterval: 30_000,
});

// EU-West service
const euWest = new SyncEngine({
  clientId: 'eu-west-1',
  backend: 'redis',
  redisConfig: { host: 'redis-eu-west.internal', port: 6379 },
  autoSync: true,
  autoSyncInterval: 30_000,
});

// Each region's auto-sync handler fetches changes from the other region
usEast.events.on('sync:start', async ({ collection }) => {
  const remoteChanges = await fetchChangesFromRegion('eu-west', collection, lastSyncTimestamp);
  if (remoteChanges.length > 0) {
    await usEast.sync(collection, remoteChanges);
  }
});
```

### Prototyping Distributed Sync

Test sync logic between services with zero infrastructure using the in-memory backend before committing to Redis or S3.

**Context:** You are designing a sync protocol for a new app and want to validate conflict resolution behavior in unit tests before deploying anything.

```ts
import { SyncEngine } from 'syncforge';

// No infrastructure needed -- pure in-memory
const server = new SyncEngine({ clientId: 'server' });
const client1 = new SyncEngine({ clientId: 'client-1', conflictStrategy: 'crdt' });
const client2 = new SyncEngine({ clientId: 'client-2', conflictStrategy: 'crdt' });

// Simulate concurrent writes
await client1.put('docs', { id: 'd1', title: 'Draft', author: 'Alice' });
await client2.put('docs', { id: 'd1', title: 'Final', author: 'Bob' });

// Test the merge
const c1Records = await client1.getAll('docs');
const result = await client2.sync('docs', c1Records);
console.log('Conflicts:', result.conflicts.length);
console.log('Resolved:', await client2.get('docs', 'd1'));

// Swap backend to Redis when ready for production -- same API, same logic
// const prod = new SyncEngine({ backend: 'redis', redisConfig: { ... } });
```

## When NOT to Use

| Scenario | Why | Use Instead |
|----------|-----|-------------|
| **Real-time character-level collaboration** (Google Docs-style) | This library operates at the record/field level, not individual character positions or text ranges | [Yjs](https://github.com/yjs/yjs), [Automerge](https://github.com/automerge/automerge) |
| **High-throughput transactional workloads** | No query language, no indexes, no ACID transactions. Not designed for thousands of writes per second | PostgreSQL, MySQL, DynamoDB |
| **Strong consistency requirements** | The engine is eventually consistent by design. There is no guarantee that a read immediately reflects a remote write | A centralized database with synchronous replication |
| **Large binary files** (images, videos, archives) | Records are serialized as JSON. Storing and diffing multi-megabyte blobs is inefficient | Object storage (S3, GCS) with a separate metadata sync |
| **Single-writer systems** | If only one process ever writes data, there are no conflicts to resolve. A regular database is simpler and faster | Any standard database or key-value store |
| **Complex relational queries** | No joins, no aggregations, no filtering beyond `getAll` and `getChangesSince` | SQLite, PostgreSQL, or an ORM layer |

## Installation

```bash
npm install syncforge
```

For Redis backend support:

```bash
npm install ioredis
```

For S3 backend support:

```bash
npm install @aws-sdk/client-s3
```

## Quick Start

```ts
import { SyncEngine } from 'syncforge';

const engine = new SyncEngine();

// Store a record
await engine.put('users', { id: '1', name: 'Alice', age: 30 });

// Retrieve it
const user = await engine.get('users', '1');
console.log(user);
// { id: '1', name: 'Alice', age: 30, _version: 1, _timestamp: ..., _deleted: false, _clientId: '...' }

// Update it
await engine.put('users', { id: '1', name: 'Alice', age: 31 });

// Delete it (soft-delete)
await engine.delete('users', '1');

// Clean up
await engine.destroy();
```

## Configuration

Pass any subset of options to the constructor. All fields have sensible defaults.

```ts
import { SyncEngine } from 'syncforge';

const engine = new SyncEngine({
  backend: 'memory',           // 'memory' | 'redis' | 's3' | 'filesystem'
  conflictStrategy: 'timestamp', // 'timestamp' | 'crdt'
  autoSync: false,             // enable periodic auto-sync
  autoSyncInterval: 30_000,   // auto-sync interval in ms (min 1000)
  maxRetries: 3,               // retry attempts for failed syncs
  batchSize: 100,              // records per batch during sync
  clientId: 'my-client',       // unique client id (auto-generated if omitted)
});
```

### Full Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backend` | `'memory' \| 'redis' \| 's3' \| 'filesystem'` | `'memory'` | Storage backend |
| `conflictStrategy` | `'timestamp' \| 'crdt'` | `'timestamp'` | Conflict resolution strategy |
| `autoSync` | `boolean` | `false` | Enable periodic sync timer |
| `autoSyncInterval` | `number` | `30000` | Timer interval in milliseconds |
| `maxRetries` | `number` | `3` | Max retry attempts on sync failure |
| `batchSize` | `number` | `100` | Records processed per batch |
| `clientId` | `string` | auto-generated | Unique identifier for this client |
| `redisConfig` | `RedisConfig` | -- | Required when `backend` is `'redis'` |
| `s3Config` | `S3Config` | -- | Required when `backend` is `'s3'` |
| `filesystemConfig` | `FilesystemConfig` | -- | Required when `backend` is `'filesystem'` |

## Storage Backends

### Memory (default)

No configuration needed. Data lives in-process and does not survive restarts.

```ts
const engine = new SyncEngine({ backend: 'memory' });
```

### Filesystem

Persists each collection as a directory and each record as a JSON file.

```ts
const engine = new SyncEngine({
  backend: 'filesystem',
  filesystemConfig: {
    directory: './data',
  },
});
```

### Redis

Stores records in Redis hashes with sorted-set timestamp indexes for efficient incremental queries. Requires the `ioredis` peer dependency.

```ts
const engine = new SyncEngine({
  backend: 'redis',
  redisConfig: {
    host: 'localhost',
    port: 6379,
    password: 'secret',    // optional
    db: 0,                 // optional, default 0
    keyPrefix: 'myapp',    // optional, default 'dse'
    tls: false,            // optional
  },
});
```

### Amazon S3

Stores records as individual JSON objects in S3. Requires the `@aws-sdk/client-s3` peer dependency.

```ts
const engine = new SyncEngine({
  backend: 's3',
  s3Config: {
    bucket: 'my-sync-bucket',
    region: 'us-east-1',
    prefix: 'sync-data',          // optional, default 'dse'
    accessKeyId: 'AKIA...',       // optional (uses default credential chain if omitted)
    secretAccessKey: '...',       // optional
    endpoint: 'http://localhost:9000', // optional, for MinIO/LocalStack
  },
});
```

## CRUD Operations

### `put(collection, record)`

Insert or update a record. The engine automatically manages `_version`, `_timestamp`, `_deleted`, and `_clientId` metadata.

```ts
const stored = await engine.put('users', { id: '1', name: 'Alice', age: 30 });
// stored._version === 1  (increments on each update)
// stored._clientId === engine.config.clientId
```

### `get(collection, id)`

Retrieve a single record. Returns `null` if not found.

```ts
const user = await engine.get('users', '1');
```

### `getAll(collection)`

Retrieve all records in a collection.

```ts
const users = await engine.getAll('users');
```

### `delete(collection, id)`

Soft-delete a record by setting `_deleted: true`. The record remains in storage so the deletion propagates during sync.

```ts
const deleted = await engine.delete('users', '1');
// deleted._deleted === true
// deleted._version === previous._version + 1
```

### `getChangesSince(collection, since)`

Retrieve all records with a `_timestamp` greater than `since`. Used for incremental sync.

```ts
const lastSync = Date.now();
// ... time passes, records change ...
const changes = await engine.getChangesSince('users', lastSync);
```

## Synchronization

### Basic Sync

The `sync()` method takes a collection name and an array of remote records, then:

1. Computes deltas (added / updated / deleted / unchanged)
2. Resolves conflicts using the configured strategy
3. Persists results in batches
4. Emits events throughout

```ts
const result = await engine.sync('users', remoteRecords);

console.log(result);
// {
//   collection: 'users',
//   added: 3,
//   updated: 1,
//   deleted: 0,
//   conflicts: [...],
//   timestamp: 1709654321000,
//   duration: 12,
// }
```

### Two-Client Sync Example

```ts
import { SyncEngine } from 'syncforge';

// Client A
const clientA = new SyncEngine({ clientId: 'client-a' });
await clientA.put('tasks', { id: 't1', title: 'Buy groceries', done: false });
await clientA.put('tasks', { id: 't2', title: 'Walk the dog', done: false });

// Client B starts empty
const clientB = new SyncEngine({ clientId: 'client-b' });

// Sync A → B
const aRecords = await clientA.getAll('tasks');
await clientB.sync('tasks', aRecords);
// Client B now has both tasks

// Client B marks a task done
await clientB.put('tasks', { id: 't1', title: 'Buy groceries', done: true });

// Sync B → A
const bRecords = await clientB.getAll('tasks');
await clientA.sync('tasks', bRecords);
// Client A now sees t1 as done

await clientA.destroy();
await clientB.destroy();
```

### Incremental Sync

Only transfer records that changed since the last checkpoint.

```ts
let lastSyncTimestamp = 0;

async function incrementalSync(local: SyncEngine, remoteEngine: SyncEngine) {
  // Get only what changed on the remote side
  const changes = await remoteEngine.getChangesSince('tasks', lastSyncTimestamp);

  if (changes.length > 0) {
    const result = await local.sync('tasks', changes);
    console.log(`Synced: +${result.added} ~${result.updated} -${result.deleted}`);
  }

  lastSyncTimestamp = Date.now();
}
```

## Conflict Resolution

When two clients edit the same record, the engine detects a conflict and resolves it automatically.

### Timestamp Strategy (default)

The record with the higher `_timestamp` wins entirely. Equal timestamps are broken by lexicographic `_clientId` comparison.

```ts
const engine = new SyncEngine({ conflictStrategy: 'timestamp' });
```

**Behavior:** Client B edits a record at `t=2000`, Client A edits it at `t=1000`. After sync, B's version wins because `2000 > 1000`.

### CRDT Strategy (field-level merge)

Uses a Last-Writer-Wins Map so that concurrent updates to *different fields* are both preserved. Only fields where both clients wrote different values are true conflicts (resolved by higher timestamp).

```ts
const engine = new SyncEngine({ conflictStrategy: 'crdt' });
```

**Example:**

```ts
// Client A updates age at t=1000
// { id: '1', name: 'Alice', age: 31, email: 'old@test.com' }

// Client B updates email at t=2000
// { id: '1', name: 'Alice', age: 30, email: 'new@test.com' }

// After CRDT merge:
// { id: '1', name: 'Alice', age: 31, email: 'new@test.com' }
//   age from A (no conflict — only A touched it... but if both touched it, higher timestamp wins)
//   email from B (no conflict — only B touched it)
```

### Inspecting Conflicts

Every `SyncResult` includes a `conflicts` array with full details:

```ts
const result = await engine.sync('users', remoteRecords);

for (const conflict of result.conflicts) {
  console.log(`Conflict on record ${conflict.recordId} in ${conflict.collection}`);
  console.log(`  Strategy: ${conflict.strategy}`);
  console.log(`  Local:`, conflict.localRecord);
  console.log(`  Remote:`, conflict.remoteRecord);
  console.log(`  Resolved:`, conflict.resolvedRecord);
  if (conflict.fieldsConflicted) {
    console.log(`  Conflicted fields:`, conflict.fieldsConflicted);
  }
}
```

## Events

The engine emits typed events for every lifecycle stage. Subscribe via `engine.events`.

```ts
engine.events.on('sync:start', (data) => {
  console.log(`Sync started for ${data.collection} (${data.recordCount} records)`);
});

engine.events.on('sync:success', (result) => {
  console.log(`Sync completed in ${result.duration}ms`);
});

engine.events.on('sync:error', (data) => {
  console.error(`Sync failed for ${data.collection}:`, data.error.message);
});

engine.events.on('conflict', (detail) => {
  console.warn(`Conflict on ${detail.recordId}, resolved via ${detail.strategy}`);
});

engine.events.on('record:added', ({ collection, record }) => {
  console.log(`[${collection}] Added: ${record.id}`);
});

engine.events.on('record:updated', ({ collection, record, previous }) => {
  console.log(`[${collection}] Updated: ${record.id} (v${previous._version} → v${record._version})`);
});

engine.events.on('record:deleted', ({ collection, record }) => {
  console.log(`[${collection}] Deleted: ${record.id}`);
});
```

### Event Reference

| Event | Payload | Fired when |
|-------|---------|------------|
| `sync:start` | `{ collection, recordCount, timestamp }` | Sync operation begins |
| `sync:success` | `SyncResult` | Sync completes successfully |
| `sync:error` | `{ collection, error, timestamp }` | Sync fails after all retries |
| `conflict` | `ConflictDetail` | A conflict is detected and resolved |
| `record:added` | `{ collection, record }` | A new record is stored |
| `record:updated` | `{ collection, record, previous }` | An existing record is updated |
| `record:deleted` | `{ collection, record }` | A record is soft-deleted |

### One-Time Listeners

```ts
engine.events.once('sync:success', (result) => {
  console.log('First sync completed!');
});
```

### Removing Listeners

```ts
const handler = (data) => console.log(data);

engine.events.on('sync:success', handler);
engine.events.off('sync:success', handler);

// Or remove all listeners for an event
engine.events.removeAllListeners('sync:success');

// Or remove all listeners entirely
engine.events.removeAllListeners();
```

## Auto-Sync

Enable a periodic timer that signals sync windows. Listen to `sync:start` events to provide remote records.

```ts
const engine = new SyncEngine({
  autoSync: true,
  autoSyncInterval: 10_000, // every 10 seconds
});

engine.events.on('sync:start', async ({ collection }) => {
  // Fetch remote records from your server / peer
  const remoteRecords = await fetchFromServer(collection);
  if (remoteRecords.length > 0) {
    await engine.sync(collection, remoteRecords);
  }
});

// Stop the timer
engine.stopAutoSync();

// Restart it
engine.startAutoSync();
```

## Retry Logic

Failed `sync()` calls automatically retry with exponential back-off (100ms, 200ms, 400ms, ...). After all retries are exhausted, a `sync:error` event is emitted and the error is thrown.

```ts
const engine = new SyncEngine({ maxRetries: 5 });

engine.events.on('sync:error', ({ collection, error }) => {
  console.error(`All retries exhausted for ${collection}:`, error.message);
});

try {
  await engine.sync('users', remoteRecords);
} catch (err) {
  // Thrown after 5 retries fail
}
```

## Batch Processing

Large sync operations are automatically split into batches. Configure the batch size:

```ts
const engine = new SyncEngine({ batchSize: 50 });

// Syncing 10,000 records processes them in chunks of 50
await engine.sync('logs', tenThousandRecords);
```

## CRDT Primitives

The library exposes its CRDT building blocks for advanced use cases.

### LWWRegister

A Last-Writer-Wins Register. Concurrent writes are resolved by timestamp; ties are broken by `clientId`.

```ts
import { LWWRegister } from 'syncforge';

const reg = new LWWRegister('initial', 1000, 'client-a');

// Update with a higher timestamp
reg.set('updated', 2000, 'client-b'); // returns true
console.log(reg.value); // 'updated'

// Rejected — lower timestamp
reg.set('old', 500, 'client-c'); // returns false
console.log(reg.value); // 'updated'

// Merge with another register's state
reg.merge({ value: 'merged', timestamp: 3000, clientId: 'client-c' });
console.log(reg.value); // 'merged'

// Serialize / deserialize
const state = reg.getState();
const restored = LWWRegister.from(state);
```

### LWWMap

A Last-Writer-Wins Map where each key is backed by an `LWWRegister`. Enables field-level conflict resolution.

```ts
import { LWWMap } from 'syncforge';

const map = new LWWMap();
map.set('name', 'Alice', 1000, 'client-a');
map.set('age', 30, 1000, 'client-a');

console.log(map.get('name')); // 'Alice'
console.log(map.toRecord());  // { name: 'Alice', age: 30 }

// Merge with another map's state
const other = new LWWMap();
other.set('name', 'Bob', 2000, 'client-b');
other.set('email', 'bob@test.com', 2000, 'client-b');

map.merge(other.getState());
console.log(map.get('name'));  // 'Bob' (higher timestamp)
console.log(map.get('email')); // 'bob@test.com' (new field)
console.log(map.get('age'));   // 30 (preserved from original)
```

### Merging StoredRecords with LWWMap

```ts
import { LWWMap } from 'syncforge';
import type { StoredRecord } from 'syncforge';

const local: StoredRecord = {
  id: '1', name: 'Alice', age: 31,
  _version: 2, _timestamp: 2000, _deleted: false, _clientId: 'a',
};
const remote: StoredRecord = {
  id: '1', name: 'Alice', email: 'alice@new.com',
  _version: 2, _timestamp: 2000, _deleted: false, _clientId: 'b',
};

const { merged, conflictedFields } = LWWMap.mergeRecords(local, remote);
// merged.age === 31          (only local had this change)
// merged.email === 'alice@new.com'  (only remote had this change)
// conflictedFields === []    (no true conflicts)
```

## Low-Level Utilities

### `computeDelta(localMap, remoteRecords)`

Classify remote records as added, updated, deleted, or unchanged relative to a local record map.

```ts
import { computeDelta } from 'syncforge';

const localMap = new Map([['1', localRecord]]);
const delta = computeDelta(localMap, remoteRecords);
// delta.added, delta.updated, delta.deleted, delta.unchanged
```

### `resolveConflict(collection, local, remote, strategy)`

Resolve a single conflict between two records.

```ts
import { resolveConflict } from 'syncforge';

const detail = resolveConflict('users', localRecord, remoteRecord, 'crdt');
console.log(detail.resolvedRecord);
console.log(detail.fieldsConflicted);
```

### `createBackend(config)`

Instantiate a storage backend from a resolved config object.

```ts
import { createBackend, resolveConfig } from 'syncforge';

const config = resolveConfig({ backend: 'memory' });
const backend = createBackend(config);

await backend.set('users', record);
const all = await backend.getAll('users');
await backend.destroy();
```

### `StorageBackend` Interface

All backends implement this interface. You can create a custom backend by implementing it:

```ts
import type { StorageBackend, StoredRecord } from 'syncforge';

class MyCustomBackend implements StorageBackend {
  async get(collection: string, id: string): Promise<StoredRecord | null> { /* ... */ }
  async getAll(collection: string): Promise<StoredRecord[]> { /* ... */ }
  async set(collection: string, record: StoredRecord): Promise<void> { /* ... */ }
  async setBatch(collection: string, records: StoredRecord[]): Promise<void> { /* ... */ }
  async delete(collection: string, id: string): Promise<void> { /* ... */ }
  async getChangesSince(collection: string, since: number): Promise<StoredRecord[]> { /* ... */ }
  async listCollections(): Promise<string[]> { /* ... */ }
  async clearCollection(collection: string): Promise<void> { /* ... */ }
  async destroy(): Promise<void> { /* ... */ }
}
```

## Record Metadata

Every record stored by the engine has these internal fields:

| Field | Type | Description |
|-------|------|-------------|
| `_version` | `number` | Monotonically increasing version counter |
| `_timestamp` | `number` | `Date.now()` at the time of the write |
| `_deleted` | `boolean` | `true` if the record has been soft-deleted |
| `_clientId` | `string` | ID of the client that performed the write |

These fields are managed automatically by `put()` and `delete()`. You should not set them manually on records passed to those methods.

## TypeScript

The library is written in TypeScript and ships with full type declarations.

```ts
import type {
  SyncRecord,
  StoredRecord,
  SyncEngineConfig,
  SyncEngineOptions,
  SyncResult,
  ConflictDetail,
  DeltaResult,
  StorageBackend,
  SyncEventMap,
  SyncEventName,
  BackendType,
  ConflictStrategy,
  RedisConfig,
  S3Config,
  FilesystemConfig,
} from 'syncforge';
```

## Lifecycle

```ts
const engine = new SyncEngine({ autoSync: true, autoSyncInterval: 5000 });

// ... use the engine ...

// Stop auto-sync without destroying
engine.stopAutoSync();

// Restart auto-sync
engine.startAutoSync();

// Full teardown: stops timers, destroys backend, removes all listeners
await engine.destroy();

// After destroy, all operations throw
await engine.put('users', { id: '1' }); // throws '[SyncForge] Engine has been destroyed.'
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build
```

## License

MIT
