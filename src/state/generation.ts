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
   *  Generate or live re-score, or ``null`` if we haven't scored yet
   *  / the deck is empty. */
  readonly lastRealism: number | null;
  /** True while a debounced live re-score is in flight; the pill
   *  renders an "(updating…)" annotation. */
  readonly scoring: boolean;
}

export const generationStore: Store<GenerationState> = createStore<GenerationState>({
  lastRealism: null,
  scoring: false,
});

// Clear ``lastRealism`` only when the deck goes empty. While the deck
// has cards, the live-realism scorer in ``state/live-realism.ts``
// takes over: it leaves the previous value in place and toggles the
// ``scoring`` flag so the pill shows "Realism N% (updating…)" until
// a fresh score lands. Per DESIGN Q4, "the number itself never
// blanks; we always show the last known value with a (updating…)
// suffix so the UI doesn't flicker."
deckStore.subscribe((state) => {
  if (state.cards.size === 0) {
    const g = generationStore.get();
    if (g.lastRealism !== null || g.scoring) {
      generationStore.set({ lastRealism: null, scoring: false });
    }
  }
});
