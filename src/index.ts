/**
 * @sakib11/data-sync-engine
 *
 * A library for incremental and conflict-free data synchronisation across
 * multiple clients or databases. Supports CRDTs, timestamp-based merges,
 * and offline-first workflows.
 */

// ─── Core engine ────────────────────────────────────────────────────────────
export { SyncEngine } from './sync/engine';

// ─── Backends ───────────────────────────────────────────────────────────────
export { createBackend } from './backends';
export { MemoryBackend } from './backends/memory';
export { FilesystemBackend } from './backends/filesystem';
export { RedisBackend } from './backends/redis';
export { S3Backend } from './backends/s3';

// ─── CRDT primitives ────────────────────────────────────────────────────────
export { LWWRegister } from './crdt/lww-register';
export type { LWWRegisterState } from './crdt/lww-register';
export { LWWMap } from './crdt/lww-map';
export type { LWWMapState } from './crdt/lww-map';

// ─── Sync utilities ─────────────────────────────────────────────────────────
export { computeDelta } from './sync/delta';
export { resolveConflict } from './sync/conflict';

// ─── Configuration ──────────────────────────────────────────────────────────
export { resolveConfig, generateClientId, DEFAULT_CONFIG } from './config';

// ─── Events ─────────────────────────────────────────────────────────────────
export { SyncEventEmitter } from './events';

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  SyncRecord,
  StoredRecord,
  BackendType,
  ConflictStrategy,
  RedisConfig,
  S3Config,
  FilesystemConfig,
  SyncEngineConfig,
  SyncEngineOptions,
  DeltaResult,
  ConflictDetail,
  SyncResult,
  SyncEventMap,
  SyncEventName,
  SyncEventHandler,
  StorageBackend,
} from './types';
