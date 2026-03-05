/**
 * @sakib11/data-sync-engine
 * Last-Writer-Wins Element Map (LWW-Map) CRDT
 *
 * An observed-remove map where each key is backed by an LWW-Register.
 * This enables field-level conflict resolution: if two clients update
 * different fields of the same record concurrently, both updates survive.
 */

import { LWWRegister, LWWRegisterState } from './lww-register';
import { StoredRecord } from '../types';

/** Internal metadata keys that should not be treated as CRDT fields */
const METADATA_KEYS = new Set(['id', '_version', '_timestamp', '_deleted', '_clientId']);

export interface LWWMapState {
  [key: string]: LWWRegisterState<unknown>;
}

export class LWWMap {
  private registers: Map<string, LWWRegister<unknown>>;

  constructor() {
    this.registers = new Map();
  }

  /**
   * Set a single field value.
   */
  set(key: string, value: unknown, timestamp: number, clientId: string): void {
    const existing = this.registers.get(key);
    if (existing) {
      existing.set(value, timestamp, clientId);
    } else {
      this.registers.set(key, new LWWRegister(value, timestamp, clientId));
    }
  }

  /**
   * Get the current value of a field.
   */
  get(key: string): unknown | undefined {
    const register = this.registers.get(key);
    return register ? register.value : undefined;
  }

  /**
   * Merge another LWWMap state into this one.
   * Each field is merged independently using its LWW-Register.
   */
  merge(otherState: LWWMapState): void {
    for (const [key, incomingState] of Object.entries(otherState)) {
      const existing = this.registers.get(key);
      if (existing) {
        existing.merge(incomingState);
      } else {
        this.registers.set(key, LWWRegister.from(incomingState));
      }
    }
  }

  /**
   * Export the full map state for serialization.
   */
  getState(): LWWMapState {
    const state: LWWMapState = {};
    for (const [key, register] of this.registers) {
      state[key] = register.getState();
    }
    return state;
  }

  /**
   * Export just the resolved values (without CRDT metadata).
   */
  toRecord(): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [key, register] of this.registers) {
      record[key] = register.value;
    }
    return record;
  }

  /**
   * Create an LWWMap from a StoredRecord.
   * Each non-metadata field becomes an LWW-Register.
   */
  static fromRecord(record: StoredRecord): LWWMap {
    const map = new LWWMap();
    const timestamp = record._timestamp;
    const clientId = record._clientId;

    for (const [key, value] of Object.entries(record)) {
      if (!METADATA_KEYS.has(key)) {
        map.set(key, value, timestamp, clientId);
      }
    }

    return map;
  }

  /**
   * Merge two StoredRecords at field level and return the merged record.
   * Fields updated by different clients are both preserved.
   * Fields updated by the same client use the latest timestamp.
   *
   * Returns an object with the merged record and the list of conflicted fields.
   */
  static mergeRecords(
    local: StoredRecord,
    remote: StoredRecord
  ): { merged: StoredRecord; conflictedFields: string[] } {
    const localMap = LWWMap.fromRecord(local);
    const remoteMap = LWWMap.fromRecord(remote);
    const conflictedFields: string[] = [];

    // Detect which fields have genuine conflicts (different values, different clients)
    for (const [key, value] of Object.entries(remote)) {
      if (METADATA_KEYS.has(key)) continue;

      const localValue = local[key];
      const remoteValue = value;

      if (
        localValue !== undefined &&
        remoteValue !== undefined &&
        JSON.stringify(localValue) !== JSON.stringify(remoteValue) &&
        local._clientId !== remote._clientId
      ) {
        conflictedFields.push(key);
      }
    }

    // Merge remote state into local map
    const remoteState = remoteMap.getState();
    localMap.merge(remoteState);

    // Build the merged record
    const mergedValues = localMap.toRecord();
    const winningTimestamp = Math.max(local._timestamp, remote._timestamp);
    const winningClientId =
      remote._timestamp > local._timestamp
        ? remote._clientId
        : remote._timestamp === local._timestamp && remote._clientId > local._clientId
          ? remote._clientId
          : local._clientId;

    const merged: StoredRecord = {
      id: local.id,
      ...mergedValues,
      _version: Math.max(local._version, remote._version) + 1,
      _timestamp: winningTimestamp,
      _deleted: local._deleted && remote._deleted,
      _clientId: winningClientId,
    };

    return { merged, conflictedFields };
  }
}
