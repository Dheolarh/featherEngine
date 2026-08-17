import type { FeatherDispose, FeatherEventMap } from './types';

type Listener<K extends keyof FeatherEventMap> = (payload: FeatherEventMap[K]) => void;

/** Typed engine-event bus with batching so a plugin edit emits one final value per event type. */
export class FeatherEventBus {
  private readonly listeners = new Map<keyof FeatherEventMap, Set<(payload: never) => void>>();
  private readonly pending = new Map<keyof FeatherEventMap, FeatherEventMap[keyof FeatherEventMap]>();
  private batchDepth = 0;

  on<K extends keyof FeatherEventMap>(event: K, listener: Listener<K>): FeatherDispose {
    const listeners = this.listeners.get(event) ?? new Set<(payload: never) => void>();
    listeners.add(listener as (payload: never) => void);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(listener as (payload: never) => void);
      if (listeners.size === 0) this.listeners.delete(event);
    };
  }

  emit<K extends keyof FeatherEventMap>(event: K, payload: FeatherEventMap[K]): void {
    if (this.batchDepth > 0) {
      this.pending.set(event, payload);
      return;
    }
    this.dispatch(event, payload);
  }

  batch<T>(action: () => T): T {
    this.batchDepth += 1;
    try {
      return action();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) this.flush();
    }
  }

  private flush(): void {
    const pending = [...this.pending.entries()];
    this.pending.clear();
    for (const [event, payload] of pending) this.dispatch(event, payload);
  }

  private dispatch<K extends keyof FeatherEventMap>(event: K, payload: FeatherEventMap[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        listener(payload as never);
      } catch (error) {
        console.error(`[Feather extensions] Event listener for "${event}" failed`, error);
      }
    }
  }
}
