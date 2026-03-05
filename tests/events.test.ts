import { describe, it, expect, vi } from 'vitest';
import { SyncEventEmitter } from '../src/events';
import { StoredRecord, SyncResult, ConflictDetail } from '../src/types';

function makeRecord(id: string): StoredRecord {
  return { id, _version: 1, _timestamp: 1000, _deleted: false, _clientId: 'c1' };
}

describe('SyncEventEmitter', () => {
  it('should emit and receive events', () => {
    const emitter = new SyncEventEmitter();
    const handler = vi.fn();
    emitter.on('record:added', handler);
    emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ collection: 'users', record: makeRecord('1') });
  });

  it('should support multiple listeners for the same event', () => {
    const emitter = new SyncEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('record:added', h1);
    emitter.on('record:added', h2);
    emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('should remove a specific listener with off()', () => {
    const emitter = new SyncEventEmitter();
    const handler = vi.fn();
    emitter.on('record:added', handler);
    emitter.off('record:added', handler);
    emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    expect(handler).not.toHaveBeenCalled();
  });

  it('once() should fire only once', () => {
    const emitter = new SyncEventEmitter();
    const handler = vi.fn();
    emitter.once('record:added', handler);
    emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    emitter.emit('record:added', { collection: 'users', record: makeRecord('2') });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners() should clear all handlers for a specific event', () => {
    const emitter = new SyncEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('record:added', h1);
    emitter.on('record:deleted', h2);
    emitter.removeAllListeners('record:added');
    emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    emitter.emit('record:deleted', { collection: 'users', record: makeRecord('1') });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners() with no argument should clear everything', () => {
    const emitter = new SyncEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('record:added', h1);
    emitter.on('record:deleted', h2);
    emitter.removeAllListeners();
    emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    emitter.emit('record:deleted', { collection: 'users', record: makeRecord('1') });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('emit() should return false when no listeners', () => {
    const emitter = new SyncEventEmitter();
    const result = emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    expect(result).toBe(false);
  });

  it('emit() should return true when listeners exist', () => {
    const emitter = new SyncEventEmitter();
    emitter.on('record:added', () => {});
    const result = emitter.emit('record:added', { collection: 'users', record: makeRecord('1') });
    expect(result).toBe(true);
  });

  it('listenerCount() should return the correct count', () => {
    const emitter = new SyncEventEmitter();
    expect(emitter.listenerCount('record:added')).toBe(0);
    emitter.on('record:added', () => {});
    emitter.on('record:added', () => {});
    expect(emitter.listenerCount('record:added')).toBe(2);
  });

  it('should catch and log handler errors without throwing', () => {
    const emitter = new SyncEventEmitter();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitter.on('record:added', () => {
      throw new Error('handler exploded');
    });
    expect(() =>
      emitter.emit('record:added', { collection: 'users', record: makeRecord('1') })
    ).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should warn when exceeding max listeners', () => {
    const emitter = new SyncEventEmitter();
    emitter.setMaxListeners(2);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    emitter.on('record:added', () => {});
    emitter.on('record:added', () => {});
    // Third listener should trigger warning
    emitter.on('record:added', () => {});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('on() should be chainable', () => {
    const emitter = new SyncEventEmitter();
    const result = emitter.on('record:added', () => {});
    expect(result).toBe(emitter);
  });
});
