/**
 * Deck state + the pure reducers that operate on it.
 *
 * Shape choice:
 *   inks   : InkT[]              — 1 or 2 inks, order is presentation-
 *                                  only (we treat the pair as a set).
 *   cards  : Map<cardId, count>  — Map (not plain object) for O(1)
 *                                  count lookups and to keep insertion
 *                                  order stable for predictable diffs.
 *   locks  : Set<cardId>         — DESIGN: locked rows persist across
 *                                  URL hash + localStorage, and AI
 *                                  features can't displace them.
 *
 * Every mutation returns a *new* DeckState so the store's listener
 * fan-out sees a referentially different object. We don't ship immer
 * yet; the deck is small (< 60 entries) and structural sharing
 * doesn't move the needle.
 *
 * Invariants are enforced inside the reducers:
 *
 * - 1 ≤ inks.length ≤ 2
 * - ``count`` ∈ [1, computeMaxCopies(card)]
 * - Every card's inks ⊆ deck.inks
 * - cards.get(id) > 0 (we drop the key when count goes to zero)
 *
 * Reducers return ``{ state, warnings }`` so callers can surface
 * non-fatal issues (e.g. "card already at max copies; no-op") in the
 * UI without bouncing through exceptions.
 */

import { computeMaxCopies, type CardT, type InkT } from "@bjorvack/lorcana-schemas";

import { cardsById } from "../data/cards";

export interface DeckState {
  readonly inks: readonly InkT[];
  readonly cards: ReadonlyMap<string, number>;
  readonly locks: ReadonlySet<string>;
}

export interface ReducerResult {
  readonly state: DeckState;
  /** Non-fatal messages the UI can render as toasts / inline notes. */
  readonly warnings: readonly string[];
}

const ok = (state: DeckState, ...warnings: string[]): ReducerResult => ({
  state,
  warnings,
});

export const emptyDeck = (inks: readonly InkT[] = ["Amber", "Steel"]): DeckState => {
  if (inks.length < 1 || inks.length > 2) {
    throw new Error(`emptyDeck: inks must hold 1 or 2 inks, got ${inks.length}`);
  }
  return { inks: [...inks], cards: new Map(), locks: new Set() };
};

// --- helpers ----------------------------------------------------

function getCard(cardId: string): CardT | null {
  return cardsById.get(cardId) ?? null;
}

function cardInkOk(card: CardT, deckInks: readonly InkT[]): boolean {
  const set = new Set(deckInks);
  return card.inks.every((i) => set.has(i));
}

function cloneCards(map: ReadonlyMap<string, number>): Map<string, number> {
  return new Map(map);
}

// --- reducers ---------------------------------------------------

export function addCard(state: DeckState, cardId: string, n = 1): ReducerResult {
  const card = getCard(cardId);
  if (!card) return ok(state, `Unknown card id: ${cardId}`);
  if (!cardInkOk(card, state.inks)) {
    return ok(state, `${card.name} is outside the chosen inks`);
  }
  if (n <= 0) return ok(state);

  const cap = computeMaxCopies(card);
  const existing = state.cards.get(cardId) ?? 0;
  const next = Math.min(existing + n, cap);
  if (next === existing) {
    return ok(state, `${card.name} is already at the ${cap}-copy cap`);
  }

  const cards = cloneCards(state.cards);
  cards.set(cardId, next);
  return ok({ ...state, cards });
}

export function removeCard(state: DeckState, cardId: string, n = 1): ReducerResult {
  const existing = state.cards.get(cardId);
  if (!existing) return ok(state);
  const cards = cloneCards(state.cards);
  const remaining = existing - n;
  if (remaining <= 0) {
    cards.delete(cardId);
    // Removing the last copy of a locked card releases the lock too.
    const locks = new Set(state.locks);
    locks.delete(cardId);
    return ok({ ...state, cards, locks });
  }
  cards.set(cardId, remaining);
  return ok({ ...state, cards });
}

export function setCount(state: DeckState, cardId: string, count: number): ReducerResult {
  const card = getCard(cardId);
  if (!card) return ok(state, `Unknown card id: ${cardId}`);
  if (count <= 0) return removeCard(state, cardId, Number.POSITIVE_INFINITY);
  const cap = computeMaxCopies(card);
  const clamped = Math.min(count, cap);
  if (!cardInkOk(card, state.inks)) {
    return ok(state, `${card.name} is outside the chosen inks`);
  }
  const cards = cloneCards(state.cards);
  cards.set(cardId, clamped);
  const warnings = clamped < count ? [`${card.name} capped at ${cap} copies`] : [];
  return { state: { ...state, cards }, warnings };
}

export function toggleLock(state: DeckState, cardId: string): ReducerResult {
  if (!state.cards.has(cardId)) {
    return ok(state, "Can't lock a card that isn't in the deck");
  }
  const locks = new Set(state.locks);
  if (locks.has(cardId)) locks.delete(cardId);
  else locks.add(cardId);
  return ok({ ...state, locks });
}

export function setInks(state: DeckState, inks: readonly InkT[]): ReducerResult {
  if (inks.length < 1 || inks.length > 2) {
    return ok(state, `Inks must be 1 or 2; got ${inks.length}`);
  }
  // Any deck card that no longer fits the new inks gets removed.
  // The UI is responsible for confirming this with the user before
  // calling setInks (DESIGN: confirmation modal); the reducer is
  // mechanical.
  const evicted: string[] = [];
  const cards = cloneCards(state.cards);
  for (const [cardId] of cards) {
    const card = getCard(cardId);
    if (!card || !cardInkOk(card, inks)) {
      cards.delete(cardId);
      if (card) evicted.push(card.name);
    }
  }
  const locks = new Set([...state.locks].filter((id) => cards.has(id)));
  const warnings =
    evicted.length > 0 ? [`Removed ${evicted.length} card(s) outside the new inks`] : [];
  return { state: { inks: [...inks], cards, locks }, warnings };
}

export function clearDeck(state: DeckState): ReducerResult {
  // Inks survive; only the deck contents and locks reset. Matches the
  // "Clear deck" button UX — keeps you on the same archetype.
  return ok({ ...state, cards: new Map(), locks: new Set() });
}
