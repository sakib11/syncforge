import { describe, it, expect } from 'vitest';
import { resolveConfig, generateClientId, DEFAULT_CONFIG } from '../src/config';

describe('generateClientId', () => {
  it('should return a string starting with "client_"', () => {
    const id = generateClientId();
    expect(id).toMatch(/^client_/);
  });

  it('should generate unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateClientId()));
    expect(ids.size).toBe(100);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_CONFIG.backend).toBe('memory');
    expect(DEFAULT_CONFIG.conflictStrategy).toBe('timestamp');
    expect(DEFAULT_CONFIG.autoSync).toBe(false);
    expect(DEFAULT_CONFIG.autoSyncInterval).toBe(30_000);
    expect(DEFAULT_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_CONFIG.batchSize).toBe(100);
  });
});

describe('resolveConfig', () => {
  it('should use defaults when no options are provided', () => {
    const config = resolveConfig({});
    expect(config.backend).toBe('memory');
    expect(config.conflictStrategy).toBe('timestamp');
    expect(config.clientId).toBeDefined();
    expect(config.clientId!.startsWith('client_')).toBe(true);
  });

  it('should accept and preserve a custom clientId', () => {
    const config = resolveConfig({ clientId: 'my-client' });
    expect(config.clientId).toBe('my-client');
  });

  it('should override defaults with provided options', () => {
    const config = resolveConfig({
      backend: 'memory',
      batchSize: 50,
      maxRetries: 5,
    });
    expect(config.batchSize).toBe(50);
    expect(config.maxRetries).toBe(5);
  });

  it('should throw when redis backend is selected without redisConfig', () => {
    expect(() => resolveConfig({ backend: 'redis' })).toThrow(/redisConfig/);
  });

  it('should throw when s3 backend is selected without s3Config', () => {
    expect(() => resolveConfig({ backend: 's3' })).toThrow(/s3Config/);
  });

  it('should throw when filesystem backend is selected without filesystemConfig', () => {
    expect(() => resolveConfig({ backend: 'filesystem' })).toThrow(/filesystemConfig/);
  });

  it('should throw when autoSyncInterval is less than 1000ms', () => {
    expect(() => resolveConfig({ autoSyncInterval: 500 })).toThrow(/autoSyncInterval/);
  });

  it('should throw when batchSize is less than 1', () => {
    expect(() => resolveConfig({ batchSize: 0 })).toThrow(/batchSize/);
  });

  it('should accept valid redis config', () => {
    const config = resolveConfig({
      backend: 'redis',
      redisConfig: { host: 'localhost', port: 6379 },
    });
    expect(config.backend).toBe('redis');
    expect(config.redisConfig).toBeDefined();
  });

  it('should accept valid s3 config', () => {
    const config = resolveConfig({
      backend: 's3',
      s3Config: { bucket: 'my-bucket', region: 'us-east-1' },
    });
    expect(config.backend).toBe('s3');
    expect(config.s3Config).toBeDefined();
  });

  it('should accept valid filesystem config', () => {
    const config = resolveConfig({
      backend: 'filesystem',
      filesystemConfig: { directory: '/tmp/data' },
    });
    expect(config.backend).toBe('filesystem');
    expect(config.filesystemConfig).toBeDefined();
  });
});
