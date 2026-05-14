/**
 * The app-wide deck store. A single instance is enough for v1;
 * components import it directly. When we add a second store (model
 * bundle state in Phase 2), this module becomes the place that
 * wires up cross-store reactions.
 */

import { cardsById } from "../data/cards";
import { type DeckState, emptyDeck } from "./deck";
import { bindStorePersistence, loadSavedDeck } from "./persistence";
import { createStore, type Store } from "./store";
import { applyHash } from "./url";

interface InitialBoot {
  state: DeckState;
  warnings: readonly string[];
}

function initialBoot(): InitialBoot {
  // Prefer the URL hash on first load so a shared link survives a
  // refresh. Anything malformed falls back silently — applyHash is
  // forgiving by design.
  if (typeof window !== "undefined" && window.location.hash) {
    const { state, warnings } = applyHash(window.location.hash);
    // Surface card ids that aren't in the bundled cards-vN — they
    // would otherwise be silently dropped by the deck-row renderer.
    const unknown: string[] = [];
    const filteredCards = new Map<string, number>();
    for (const [id, count] of state.cards) {
      if (cardsById.has(id)) filteredCards.set(id, count);
      else unknown.push(id);
    }
    const extra =
      unknown.length > 0
        ? [
            `Dropped ${unknown.length} card${unknown.length === 1 ? "" : "s"} from the URL that are not in the current pool (${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? "…" : ""}).`,
          ]
        : [];
    return {
      state: { ...state, cards: filteredCards },
      warnings: [...warnings, ...extra],
    };
  }
  // No URL hash: fall back to a previously-saved deck if any, else
  // a fresh empty one. localStorage is non-blocking: a corrupt or
  // unreadable payload just looks like "no saved deck".
  const saved = loadSavedDeck();
  if (saved) {
    const filteredCards = new Map<string, number>();
    for (const [id, count] of saved.cards) {
      if (cardsById.has(id)) filteredCards.set(id, count);
    }
    return {
      state: { ...saved, cards: filteredCards },
      warnings: [],
    };
  }
  return { state: emptyDeck(), warnings: [] };
}

const boot = initialBoot();

export const deckStore: Store<DeckState> = createStore<DeckState>(boot.state);

// Persist every store update to localStorage. URL hash takes
// precedence at boot, so this is purely a "next visit" memory.
bindStorePersistence(deckStore);

/** Warnings produced while parsing the URL hash on first load. */
export const initialWarnings: readonly string[] = boot.warnings;
