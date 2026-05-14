/**
 * Ephemeral state from the most recent deck generation.
 *
 * Separate from ``deckStore`` because this state is purely UX
 * feedback: the realism score is meaningful right after a Generate
 * click but goes stale the moment the user edits the deck. Keeping
 * it in its own tiny store means deck-state reducers don't have to
 * remember to clear an unrelated field.
 *
 * The deck-generator writes ``lastRealism`` on success; the deck-store
 * subscription below clears it on every deck mutation so the pill
 * disappears as soon as the deck no longer matches what the model
 * scored.
 */

import { createStore, type Store } from "./store";
import { deckStore } from "./index";

export interface GenerationState {
  /** Calibrated evaluator score in [0, 1] from the most recent
   *  Generate, or ``null`` if the deck has been edited since (or
   *  Generate has never run). */
  readonly lastRealism: number | null;
}

export const generationStore: Store<GenerationState> = createStore<GenerationState>({
  lastRealism: null,
});

// Invalidate ``lastRealism`` whenever the deck changes. We compare a
// fingerprint of the deck contents to avoid resetting on a no-op
// store update (e.g. a format swap that doesn't touch the cards).
let lastFingerprint = fingerprint(deckStore.get().cards);
deckStore.subscribe((state) => {
  const fp = fingerprint(state.cards);
  if (fp !== lastFingerprint) {
    lastFingerprint = fp;
    if (generationStore.get().lastRealism !== null) {
      generationStore.set({ lastRealism: null });
    }
  }
});

function fingerprint(cards: ReadonlyMap<string, number>): string {
  // Insertion order is stable for Map, and the deck reducers always
  // clone the Map, so the order reflects edit history. Fine for a
  // change detector but not safe for cross-session equality.
  const parts: string[] = [];
  for (const [id, count] of cards) parts.push(`${id}:${count}`);
  return parts.join(",");
}
