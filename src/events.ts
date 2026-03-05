/**
 * @sakib11/data-sync-engine
 * Typed EventEmitter that works in Node.js, browser, and edge runtimes.
 *
 * This is a minimal implementation that does not depend on Node's `events`
 * module, making it safe to use in browser bundles.
 */

import { SyncEventName, SyncEventMap, SyncEventHandler } from './types';

type ListenerMap = {
  [E in SyncEventName]?: Set<SyncEventHandler<E>>;
};

export class SyncEventEmitter {
  private listeners: ListenerMap = {};
  private maxListeners: number = 50;

  /**
   * Register an event handler.
   */
  on<E extends SyncEventName>(event: E, handler: SyncEventHandler<E>): this {
    if (!this.listeners[event]) {
      (this.listeners as Record<string, Set<SyncEventHandler<E>>>)[event] = new Set();
    }

    const set = this.listeners[event] as Set<SyncEventHandler<E>>;

    if (set.size >= this.maxListeners) {
      console.warn(
        `[DataSyncEngine] Warning: more than ${this.maxListeners} listeners ` +
        `for event "${event}". Possible memory leak.`
      );
    }

    set.add(handler);
    return this;
  }

  /**
   * Register a one-time event handler. It is removed after the first invocation.
   */
  once<E extends SyncEventName>(event: E, handler: SyncEventHandler<E>): this {
    const wrapped: SyncEventHandler<E> = (data) => {
      this.off(event, wrapped);
      handler(data);
    };
    return this.on(event, wrapped);
  }

  /**
   * Remove an event handler.
   */
  off<E extends SyncEventName>(event: E, handler: SyncEventHandler<E>): this {
    const set = this.listeners[event] as Set<SyncEventHandler<E>> | undefined;
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        delete this.listeners[event];
      }
    }
    return this;
  }

  /**
   * Remove all handlers for a given event, or all handlers entirely.
   */
  removeAllListeners(event?: SyncEventName): this {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
    return this;
  }

  /**
   * Emit an event, calling all registered handlers synchronously.
   */
  emit<E extends SyncEventName>(event: E, data: SyncEventMap[E]): boolean {
    const set = this.listeners[event] as Set<SyncEventHandler<E>> | undefined;
    if (!set || set.size === 0) {
      return false;
    }

    for (const handler of set) {
      try {
        handler(data);
      } catch (err) {
        console.error(
          `[DataSyncEngine] Error in "${event}" handler:`,
          err
        );
      }
    }
    return true;
  }

  /**
   * Get the count of listeners for a given event.
   */
  listenerCount(event: SyncEventName): number {
    const set = this.listeners[event];
    return set ? set.size : 0;
  }

  /**
   * Set the maximum number of listeners per event before a warning is emitted.
   */
  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }
}
