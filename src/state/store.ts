/** Tiny pub/sub store. TODO. */
export type Listener<T> = (state: T) => void;

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  return {
    get: () => state,
    set: (next: T) => {
      state = next;
      for (const l of listeners) l(state);
    },
    subscribe: (l: Listener<T>) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
