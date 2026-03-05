/**
 * syncforge
 * Backend factory and barrel exports.
 */

import { StorageBackend, SyncEngineConfig } from '../types';
import { MemoryBackend } from './memory';
import { FilesystemBackend } from './filesystem';
import { RedisBackend } from './redis';
import { S3Backend } from './s3';

export { MemoryBackend } from './memory';
export { FilesystemBackend } from './filesystem';
export { RedisBackend } from './redis';
export { S3Backend } from './s3';

/**
 * Create a StorageBackend instance from the resolved engine configuration.
 */
export function createBackend(config: SyncEngineConfig): StorageBackend {
  switch (config.backend) {
    case 'memory':
      return new MemoryBackend();

    case 'filesystem':
      if (!config.filesystemConfig) {
        throw new Error('[SyncForge] filesystemConfig is required for the filesystem backend.');
      }
      return new FilesystemBackend(config.filesystemConfig.directory);

    case 'redis':
      if (!config.redisConfig) {
        throw new Error('[SyncForge] redisConfig is required for the redis backend.');
      }
      return new RedisBackend(config.redisConfig);

    case 's3':
      if (!config.s3Config) {
        throw new Error('[SyncForge] s3Config is required for the s3 backend.');
      }
      return new S3Backend(config.s3Config);

    default: {
      const exhaustive: never = config.backend;
      throw new Error(`[SyncForge] Unknown backend type: ${exhaustive}`);
    }
  }
}
