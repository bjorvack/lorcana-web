/**
 * Derived views over ``DeckState``.
 *
 * Pure functions only. Components subscribe to the store, run the
 * selector they care about, and re-render — no memoisation today
 * (the deck has tens of cards, not thousands).
 *
 * The validity selector wraps the ``isTournamentLegal`` helper from
 * ``@bjorvack/lorcana-schemas`` so the web app's notion of "legal"
 * never drifts from the scraper's / training pipeline's.
 */

import { isTournamentLegal, type CardT } from "@bjorvack/lorcana-schemas";

import { cardsById } from "../data/cards";
import type { DeckState } from "./deck";

export const TYPES = ["Character", "Action", "Song", "Item", "Location"] as const;
export type CardType = (typeof TYPES)[number];

export interface DeckRow {
  readonly card: CardT;
  readonly count: number;
  readonly locked: boolean;
}

export interface ManaCurvePoint {
  /** Cost bucket; 7 represents 7+ to keep the curve compact. */
  readonly cost: number;
  readonly count: number;
}

export const MAX_CURVE_COST = 7;

export interface DeckSummary {
  readonly total: number;
  readonly distinct: number;
  readonly typeBreakdown: ReadonlyMap<CardType, number>;
  readonly curve: readonly ManaCurvePoint[];
}

export interface DeckValidity {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

export function totalCards(state: DeckState): number {
  let n = 0;
  for (const count of state.cards.values()) n += count;
  return n;
}

export function distinctCards(state: DeckState): number {
  return state.cards.size;
}

export function deckRows(state: DeckState): readonly DeckRow[] {
  const rows: DeckRow[] = [];
  for (const [cardId, count] of state.cards) {
    const card = cardsById.get(cardId);
    if (!card) continue; // out-of-pool ids are surfaced by the validity selector below
    rows.push({ card, count, locked: state.locks.has(cardId) });
  }
  // Stable sort: by cost, then type, then name. Matches what
  // tournament-grade builders show — costs together, then alpha.
  rows.sort((a, b) => {
    if (a.card.cost !== b.card.cost) return a.card.cost - b.card.cost;
    const ta = a.card.types[0] ?? "";
    const tb = b.card.types[0] ?? "";
    if (ta !== tb) return ta.localeCompare(tb);
    return a.card.name.localeCompare(b.card.name);
  });
  return rows;
}

export function typeBreakdown(state: DeckState): ReadonlyMap<CardType, number> {
  const out = new Map<CardType, number>(TYPES.map((t) => [t, 0]));
  for (const [cardId, count] of state.cards) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    for (const t of card.types) {
      if ((TYPES as readonly string[]).includes(t)) {
        out.set(t as CardType, (out.get(t as CardType) ?? 0) + count);
      }
    }
  }
  return out;
}

export function manaCurve(state: DeckState): readonly ManaCurvePoint[] {
  const buckets = new Array<number>(MAX_CURVE_COST + 1).fill(0);
  for (const [cardId, count] of state.cards) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const bucket = Math.min(card.cost, MAX_CURVE_COST);
    buckets[bucket] = (buckets[bucket] ?? 0) + count;
  }
  return buckets.map((count, cost) => ({ cost, count }));
}

export function summary(state: DeckState): DeckSummary {
  return {
    total: totalCards(state),
    distinct: distinctCards(state),
    typeBreakdown: typeBreakdown(state),
    curve: manaCurve(state),
  };
}

export function validity(state: DeckState): DeckValidity {
  const cards = [...state.cards].map(([cardId, count]) => ({ cardId, count }));
  const result = isTournamentLegal(
    { inks: [...state.inks], cards },
    cardsById as Map<string, CardT>,
  );
  if (result.ok) return { ok: true, reasons: [] };
  return { ok: false, reasons: result.reasons };
}
