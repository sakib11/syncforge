/**
 * syncforge
 * Delta computation — compares local state against incoming remote records
 * and classifies each record as added, updated, deleted, or unchanged.
 */

import { StoredRecord, DeltaResult } from '../types';

/**
 * Compute deltas between a set of local records and incoming remote records.
 *
 * Classification rules:
 *   - **added**: record exists in remote but not locally
 *   - **updated**: record exists in both but remote has a higher version or timestamp
 *   - **deleted**: record exists in remote, is marked `_deleted`, and local copy is not deleted
 *   - **unchanged**: record exists in both with no meaningful changes
 *
 * @param localRecords  - current local records indexed by id
 * @param remoteRecords - incoming remote records
 */
export function computeDelta(
  localRecords: Map<string, StoredRecord>,
  remoteRecords: StoredRecord[]
): DeltaResult {
  const added: StoredRecord[] = [];
  const updated: StoredRecord[] = [];
  const deleted: StoredRecord[] = [];
  const unchanged: StoredRecord[] = [];

  for (const remote of remoteRecords) {
    const local = localRecords.get(remote.id);

    if (!local) {
      // Record only exists remotely
      if (remote._deleted) {
        // Remote record is already deleted and we never had it — skip
        unchanged.push(remote);
      } else {
        added.push(remote);
      }
      continue;
    }

    // Both exist — compare
    if (remote._deleted && !local._deleted) {
      deleted.push(remote);
    } else if (
      remote._version > local._version ||
      remote._timestamp > local._timestamp
    ) {
      updated.push(remote);
    } else {
      unchanged.push(remote);
    }
  }

  return { added, updated, deleted, unchanged };
}
