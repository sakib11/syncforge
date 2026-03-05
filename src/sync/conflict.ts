/**
 * syncforge
 * Conflict resolution strategies.
 *
 * Two strategies are supported:
 *   1. **timestamp** – the record with the higher `_timestamp` wins entirely.
 *      Ties are broken by lexicographic comparison of `_clientId`.
 *   2. **crdt** – field-level merge using LWW-Map. Concurrent updates to
 *      different fields are both preserved.
 */

import { StoredRecord, ConflictDetail, ConflictStrategy } from '../types';
import { LWWMap } from '../crdt/lww-map';

/**
 * Resolve a conflict between a local and remote version of the same record.
 *
 * @returns A `ConflictDetail` object describing the resolution.
 */
export function resolveConflict(
  collection: string,
  local: StoredRecord,
  remote: StoredRecord,
  strategy: ConflictStrategy
): ConflictDetail {
  if (strategy === 'crdt') {
    return resolveCRDT(collection, local, remote);
  }
  return resolveTimestamp(collection, local, remote);
}

// ─── Timestamp strategy ────────────────────────────────────────────────────

function resolveTimestamp(
  collection: string,
  local: StoredRecord,
  remote: StoredRecord
): ConflictDetail {
  let resolvedRecord: StoredRecord;

  if (remote._timestamp > local._timestamp) {
    resolvedRecord = { ...remote, _version: Math.max(local._version, remote._version) + 1 };
  } else if (remote._timestamp < local._timestamp) {
    resolvedRecord = { ...local, _version: Math.max(local._version, remote._version) + 1 };
  } else {
    // Timestamps are equal — break tie by clientId (lexicographically greater wins)
    if (remote._clientId > local._clientId) {
      resolvedRecord = { ...remote, _version: Math.max(local._version, remote._version) + 1 };
    } else {
      resolvedRecord = { ...local, _version: Math.max(local._version, remote._version) + 1 };
    }
  }

  return {
    recordId: local.id,
    collection,
    localRecord: local,
    remoteRecord: remote,
    resolvedRecord,
    strategy: 'timestamp',
  };
}

// ─── CRDT strategy ─────────────────────────────────────────────────────────

function resolveCRDT(
  collection: string,
  local: StoredRecord,
  remote: StoredRecord
): ConflictDetail {
  const { merged, conflictedFields } = LWWMap.mergeRecords(local, remote);

  return {
    recordId: local.id,
    collection,
    localRecord: local,
    remoteRecord: remote,
    resolvedRecord: merged,
    strategy: 'crdt',
    fieldsConflicted: conflictedFields.length > 0 ? conflictedFields : undefined,
  };
}
