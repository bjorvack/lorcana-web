/**
 * localStorage persistence for the deck store.
 *
 * Saves the user's last-edited deck so a refresh without a URL hash
 * still brings them back to where they were. Honours URL hash > local
 * storage > defaults at boot — a shared link always wins over a
 * previously-saved local state, matching the user's expectation
 * that "the link I clicked is what I see".
 *
 * Payload shape mirrors ``DeckState`` minus things we recompute at
 * load (e.g. format defaults). Versioned so a future schema bump
 * can ignore stale storage without confusing users.
 */

import type { InkT } from "@bjorvack/lorcana-schemas";

import { defaultFormat, type Format } from "../data/legality";
import { type DeckState, emptyDeck } from "./deck";
import type { Store } from "./store";

const STORAGE_KEY = "lorcana:deck:v1";
const STORAGE_VERSION = 1;

interface Serialised {
  readonly version: number;
  readonly inks: readonly string[];
  readonly cards: readonly (readonly [string, number])[];
  readonly locks: readonly string[];
  readonly format: string;
}

function isInk(v: string): v is InkT {
  return (
    v === "Amber" ||
    v === "Amethyst" ||
    v === "Emerald" ||
    v === "Ruby" ||
    v === "Sapphire" ||
    v === "Steel"
  );
}

function isFormat(v: string): v is Format {
  return v === "core_constructed" || v === "infinity_constructed";
}

export function loadSavedDeck(): DeckState | null {
  if (typeof localStorage === "undefined") return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: Serialised;
  try {
    parsed = JSON.parse(raw) as Serialised;
  } catch {
    return null;
  }
  if (!parsed || parsed.version !== STORAGE_VERSION) return null;
  const inks = (parsed.inks ?? []).filter(isInk);
  if (inks.length < 1 || inks.length > 2) return null;
  const format = isFormat(parsed.format ?? "") ? (parsed.format as Format) : defaultFormat();
  const cards = new Map<string, number>();
  for (const entry of parsed.cards ?? []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [id, count] = entry;
    if (typeof id !== "string" || !id || typeof count !== "number" || count <= 0) continue;
    cards.set(id, count);
  }
  const locks = new Set<string>();
  for (const id of parsed.locks ?? []) if (typeof id === "string") locks.add(id);
  const base = emptyDeck(inks, format);
  return { ...base, cards, locks };
}

export function saveDeck(state: DeckState): void {
  if (typeof localStorage === "undefined") return;
  const payload: Serialised = {
    version: STORAGE_VERSION,
    inks: state.inks.slice(),
    cards: [...state.cards.entries()],
    locks: [...state.locks],
    format: state.format,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded / disabled storage / private mode — non-fatal.
  }
}

export function clearSavedDeck(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same fail-quiet contract as ``saveDeck``.
  }
}

/**
 * Wire a store to localStorage: subscribe with a debounce so a
 * rapid-fire Generate that touches the store many times doesn't
 * thrash the quota.
 */
export function bindStorePersistence(store: Store<DeckState>, debounceMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return store.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveDeck(state), debounceMs);
  });
}
