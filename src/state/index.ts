/**
 * The app-wide deck store. A single instance is enough for v1;
 * components import it directly. When we add a second store (model
 * bundle state in Phase 2), this module becomes the place that
 * wires up cross-store reactions.
 */

import { type DeckState, emptyDeck } from "./deck";
import { createStore, type Store } from "./store";
import { applyHash } from "./url";

function initialState(): DeckState {
  // Prefer the URL hash on first load so a shared link survives a
  // refresh. Anything malformed falls back silently — applyHash is
  // forgiving by design.
  if (typeof window !== "undefined" && window.location.hash) {
    return applyHash(window.location.hash).state;
  }
  return emptyDeck();
}

export const deckStore: Store<DeckState> = createStore<DeckState>(initialState());
