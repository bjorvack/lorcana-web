/**
 * Tiny pub/sub store.
 *
 * The whole app's state is a single immutable value (the ``DeckState``
 * for now; the model-bundle state will join it later). Components
 * subscribe and re-render when notified. We deliberately don't ship
 * a framework — at this app's scale a 30-line store outperforms the
 * runtime + mental cost of redux / zustand / signals.
 *
 * Two niceties on top of the obvious set:
 *
 * - ``update(reducer)`` for the "compute next from current" case.
 *   Keeps callsites pure and lets us swap in structural-sharing
 *   helpers (e.g. immer) later without touching them.
 * - ``subscribe`` returns its own unsubscriber so callers can dispose
 *   listeners without holding the listener reference.
 *
 * The store does *not* short-circuit identical updates — that's a
 * caller decision. Adding `Object.is`-based equality here would
 * mask bugs where mutations forget to clone.
 */

export type Listener<T> = (state: T) => void;
export type Reducer<T> = (current: T) => T;

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(reducer: Reducer<T>): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  const notify = (): void => {
    // Snapshot before iterating so a listener that unsubscribes
    // itself doesn't break the iteration order.
    for (const l of [...listeners]) l(state);
  };

  return {
    get: () => state,
    set: (next: T) => {
      state = next;
      notify();
    },
    update: (reducer: Reducer<T>) => {
      state = reducer(state);
      notify();
    },
    subscribe: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
