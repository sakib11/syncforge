/**
 * @sakib11/data-sync-engine
 * Last-Writer-Wins Register (LWW-Register) CRDT
 *
 * A convergent replicated data type where concurrent writes are resolved
 * by keeping the value with the highest timestamp. Ties are broken by
 * comparing client IDs lexicographically.
 */

export interface LWWRegisterState<T> {
  value: T;
  timestamp: number;
  clientId: string;
}

export class LWWRegister<T> {
  private state: LWWRegisterState<T>;

  constructor(value: T, timestamp: number, clientId: string) {
    this.state = { value, timestamp, clientId };
  }

  /** Get the current value */
  get value(): T {
    return this.state.value;
  }

  /** Get the timestamp of the last write */
  get timestamp(): number {
    return this.state.timestamp;
  }

  /** Get the client ID that performed the last write */
  get clientId(): string {
    return this.state.clientId;
  }

  /**
   * Update the register with a new value.
   * Only succeeds if the new timestamp is greater than or equal to the current one.
   */
  set(value: T, timestamp: number, clientId: string): boolean {
    if (this.shouldAccept(timestamp, clientId)) {
      this.state = { value, timestamp, clientId };
      return true;
    }
    return false;
  }

  /**
   * Merge another register state into this one.
   * The register with the higher timestamp wins.
   * Ties are broken by lexicographic comparison of client IDs.
   */
  merge(other: LWWRegisterState<T>): LWWRegisterState<T> {
    if (this.shouldAccept(other.timestamp, other.clientId)) {
      this.state = { ...other };
    }
    return this.getState();
  }

  /** Get the full internal state (for serialization) */
  getState(): LWWRegisterState<T> {
    return { ...this.state };
  }

  /**
   * Determine whether an incoming write should be accepted.
   * Returns true if the incoming timestamp is newer, or if timestamps
   * are equal and the incoming clientId is lexicographically greater.
   */
  private shouldAccept(incomingTimestamp: number, incomingClientId: string): boolean {
    if (incomingTimestamp > this.state.timestamp) {
      return true;
    }
    if (
      incomingTimestamp === this.state.timestamp &&
      incomingClientId > this.state.clientId
    ) {
      return true;
    }
    return false;
  }

  /**
   * Create an LWWRegister from a serialized state.
   */
  static from<T>(state: LWWRegisterState<T>): LWWRegister<T> {
    return new LWWRegister(state.value, state.timestamp, state.clientId);
  }
}
