import { describe, it, expect } from 'vitest';
import { LWWRegister } from '../src/crdt/lww-register';

describe('LWWRegister', () => {
  it('should store initial value, timestamp, and clientId', () => {
    const reg = new LWWRegister('hello', 1000, 'client_a');
    expect(reg.value).toBe('hello');
    expect(reg.timestamp).toBe(1000);
    expect(reg.clientId).toBe('client_a');
  });

  it('should accept a set with a higher timestamp', () => {
    const reg = new LWWRegister('v1', 1000, 'client_a');
    const accepted = reg.set('v2', 2000, 'client_b');
    expect(accepted).toBe(true);
    expect(reg.value).toBe('v2');
    expect(reg.timestamp).toBe(2000);
    expect(reg.clientId).toBe('client_b');
  });

  it('should reject a set with a lower timestamp', () => {
    const reg = new LWWRegister('v1', 2000, 'client_a');
    const accepted = reg.set('v2', 1000, 'client_b');
    expect(accepted).toBe(false);
    expect(reg.value).toBe('v1');
  });

  it('should break ties by clientId (lexicographically greater wins)', () => {
    const reg = new LWWRegister('v1', 1000, 'client_a');
    // Same timestamp, greater clientId → accept
    const accepted = reg.set('v2', 1000, 'client_b');
    expect(accepted).toBe(true);
    expect(reg.value).toBe('v2');
  });

  it('should reject equal timestamp with lower clientId', () => {
    const reg = new LWWRegister('v1', 1000, 'client_b');
    const accepted = reg.set('v2', 1000, 'client_a');
    expect(accepted).toBe(false);
    expect(reg.value).toBe('v1');
  });

  it('should merge with a higher timestamp state', () => {
    const reg = new LWWRegister('v1', 1000, 'client_a');
    const result = reg.merge({ value: 'v2', timestamp: 2000, clientId: 'client_b' });
    expect(reg.value).toBe('v2');
    expect(result.value).toBe('v2');
  });

  it('should not merge with a lower timestamp state', () => {
    const reg = new LWWRegister('v1', 2000, 'client_a');
    reg.merge({ value: 'v2', timestamp: 1000, clientId: 'client_b' });
    expect(reg.value).toBe('v1');
  });

  it('getState should return a copy of the internal state', () => {
    const reg = new LWWRegister('v1', 1000, 'client_a');
    const state = reg.getState();
    expect(state).toEqual({ value: 'v1', timestamp: 1000, clientId: 'client_a' });
    // Mutating the returned state should not affect the register
    state.value = 'mutated';
    expect(reg.value).toBe('v1');
  });

  it('static from() should deserialize correctly', () => {
    const reg = LWWRegister.from({ value: 42, timestamp: 5000, clientId: 'client_x' });
    expect(reg.value).toBe(42);
    expect(reg.timestamp).toBe(5000);
    expect(reg.clientId).toBe('client_x');
  });

  it('should work with complex value types', () => {
    const reg = new LWWRegister({ nested: true }, 1000, 'client_a');
    expect(reg.value).toEqual({ nested: true });
    reg.set({ nested: false }, 2000, 'client_b');
    expect(reg.value).toEqual({ nested: false });
  });
});
