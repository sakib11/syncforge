/**
 * @sakib11/data-sync-engine
 * Type definitions for the Data Sync Engine
 */

// ─── Record Types ────────────────────────────────────────────────────────────

/**
 * A synchronizable record. Every record must have an `id` field.
 * Internal metadata fields (_version, _timestamp, _deleted, _clientId) are
 * managed by the engine and should not be set manually.
 */
export interface SyncRecord {
  id: string;
  [key: string]: unknown;
  _version?: number;
  _timestamp?: number;
  _deleted?: boolean;
  _clientId?: string;
}

/**
 * A record with all internal metadata guaranteed to be present.
 * This is the shape stored in backends.
 */
export interface StoredRecord extends SyncRecord {
  _version: number;
  _timestamp: number;
  _deleted: boolean;
  _clientId: string;
}

// ─── Configuration ───────────────────────────────────────────────────────────

export type BackendType = 'memory' | 'redis' | 's3' | 'filesystem';
export type ConflictStrategy = 'timestamp' | 'crdt';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  tls?: boolean;
}

export interface S3Config {
  bucket: string;
  region: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
}

export interface FilesystemConfig {
  directory: string;
}

export interface SyncEngineConfig {
  /** Storage backend to use. Default: 'memory' */
  backend: BackendType;

  /** Conflict resolution strategy. Default: 'timestamp' */
  conflictStrategy: ConflictStrategy;

  /** Enable automatic periodic sync. Default: false */
  autoSync: boolean;

  /** Auto-sync interval in milliseconds. Default: 30000 */
  autoSyncInterval: number;

  /** Maximum retry attempts for failed sync operations. Default: 3 */
  maxRetries: number;

  /** Number of records to process per batch. Default: 100 */
  batchSize: number;

  /** Unique client identifier. Auto-generated if not provided. */
  clientId?: string;

  /** Redis configuration (required when backend is 'redis') */
  redisConfig?: RedisConfig;

  /** S3 configuration (required when backend is 's3') */
  s3Config?: S3Config;

  /** Filesystem configuration (required when backend is 'filesystem') */
  filesystemConfig?: FilesystemConfig;
}

/** Partial config accepted by the constructor */
export type SyncEngineOptions = Partial<SyncEngineConfig>;

// ─── Sync Results ────────────────────────────────────────────────────────────

export interface DeltaResult {
  added: StoredRecord[];
  updated: StoredRecord[];
  deleted: StoredRecord[];
  unchanged: StoredRecord[];
}

export interface ConflictDetail {
  recordId: string;
  collection: string;
  localRecord: StoredRecord;
  remoteRecord: StoredRecord;
  resolvedRecord: StoredRecord;
  strategy: ConflictStrategy;
  fieldsConflicted?: string[];
}

export interface SyncResult {
  collection: string;
  added: number;
  updated: number;
  deleted: number;
  conflicts: ConflictDetail[];
  timestamp: number;
  duration: number;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface SyncEventMap {
  'sync:start': { collection: string; recordCount: number; timestamp: number };
  'sync:success': SyncResult;
  'sync:error': { collection: string; error: Error; timestamp: number };
  'conflict': ConflictDetail;
  'record:added': { collection: string; record: StoredRecord };
  'record:updated': { collection: string; record: StoredRecord; previous: StoredRecord };
  'record:deleted': { collection: string; record: StoredRecord };
}

export type SyncEventName = keyof SyncEventMap;
export type SyncEventHandler<E extends SyncEventName> = (data: SyncEventMap[E]) => void;

// ─── Storage Backend ─────────────────────────────────────────────────────────

/**
 * Interface that all storage backends must implement.
 */
export interface StorageBackend {
  /** Retrieve a single record by collection and id */
  get(collection: string, id: string): Promise<StoredRecord | null>;

  /** Retrieve all records in a collection */
  getAll(collection: string): Promise<StoredRecord[]>;

  /** Store a single record */
  set(collection: string, record: StoredRecord): Promise<void>;

  /** Store multiple records at once */
  setBatch(collection: string, records: StoredRecord[]): Promise<void>;

  /** Delete a record by collection and id */
  delete(collection: string, id: string): Promise<void>;

  /** Get all records changed since a given timestamp */
  getChangesSince(collection: string, since: number): Promise<StoredRecord[]>;

  /** List all known collection names */
  listCollections(): Promise<string[]>;

  /** Clear all data in a collection */
  clearCollection(collection: string): Promise<void>;

  /** Tear down connections / resources */
  destroy(): Promise<void>;
}
