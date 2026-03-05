/**
 * @sakib11/data-sync-engine
 * Default configuration with sensible defaults
 */

import { SyncEngineConfig } from './types';

/**
 * Generate a unique client ID using timestamp + random suffix.
 * Works in both Node.js and browser environments.
 */
export function generateClientId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `client_${timestamp}_${random}`;
}

/**
 * Default configuration object.
 * All values are sensible defaults for getting started quickly.
 */
export const DEFAULT_CONFIG: SyncEngineConfig = {
  backend: 'memory',
  conflictStrategy: 'timestamp',
  autoSync: false,
  autoSyncInterval: 30_000,
  maxRetries: 3,
  batchSize: 100,
  clientId: undefined,
};

/**
 * Merge user-provided options with defaults and validate.
 */
export function resolveConfig(options: Partial<SyncEngineConfig>): SyncEngineConfig {
  const config: SyncEngineConfig = {
    ...DEFAULT_CONFIG,
    ...options,
    clientId: options.clientId || generateClientId(),
  };

  // Validate backend-specific configuration
  if (config.backend === 'redis' && !config.redisConfig) {
    throw new Error(
      '[DataSyncEngine] Redis backend selected but no redisConfig provided. ' +
      'Please provide { host, port } at minimum.'
    );
  }

  if (config.backend === 's3' && !config.s3Config) {
    throw new Error(
      '[DataSyncEngine] S3 backend selected but no s3Config provided. ' +
      'Please provide { bucket, region } at minimum.'
    );
  }

  if (config.backend === 'filesystem' && !config.filesystemConfig) {
    throw new Error(
      '[DataSyncEngine] Filesystem backend selected but no filesystemConfig provided. ' +
      'Please provide { directory } at minimum.'
    );
  }

  if (config.autoSyncInterval < 1000) {
    throw new Error(
      '[DataSyncEngine] autoSyncInterval must be at least 1000ms.'
    );
  }

  if (config.batchSize < 1) {
    throw new Error(
      '[DataSyncEngine] batchSize must be at least 1.'
    );
  }

  return config;
}
