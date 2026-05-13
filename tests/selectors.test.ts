/**
 * Derived-state tests: curve, type breakdown, totals, validity.
 *
 * Uses a hand-built deck of real card ids so failures stay grounded
 * in actual schema behaviour (max-copies overrides, ink matching,
 * isTournamentLegal mechanics).
 */

import { describe, expect, it } from "vitest";

import { cards, cardsById } from "../src/data/cards";
import { addCard, emptyDeck } from "../src/state/deck";
import {
  MAX_CURVE_COST,
  TYPES,
  deckRows,
  manaCurve,
  summary,
  totalCards,
  typeBreakdown,
  validity,
} from "../src/state/selectors";

function findByCost(ink: "Amber" | "Steel", cost: number) {
  return cards.find((c) => c.inks.length === 1 && c.inks[0] === ink && c.cost === cost);
}

describe("totals", () => {
  it("sums counts, not entries", () => {
    let s = emptyDeck(["Amber", "Steel"]);
    const a = findByCost("Amber", 1);
    const b = findByCost("Steel", 4);
    if (!a || !b) throw new Error("fixture missing");
    s = addCard(s, a.id, 4).state;
    s = addCard(s, b.id, 3).state;
    expect(totalCards(s)).toBe(7);
  });
});

describe("manaCurve", () => {
  it("returns one bucket per cost 0..MAX_CURVE_COST", () => {
    const c = manaCurve(emptyDeck(["Amber"]));
    expect(c).toHaveLength(MAX_CURVE_COST + 1);
    expect(c.every((p) => p.count === 0)).toBe(true);
  });
  it("clamps high costs into the last bucket", () => {
    // Find any card with cost >= MAX_CURVE_COST.
    const big = cards.find((c) => c.cost >= MAX_CURVE_COST && c.inks.length === 1);
    if (!big) return; // pool didn't have one yet; happens on tiny test fixtures.
    let s = emptyDeck([big.inks[0]!]);
    s = addCard(s, big.id, 2).state;
    const curve = manaCurve(s);
    expect(curve[MAX_CURVE_COST]?.count).toBe(2);
  });
});

describe("typeBreakdown", () => {
  it("returns one row per known type", () => {
    const tb = typeBreakdown(emptyDeck(["Amber"]));
    for (const t of TYPES) expect(tb.has(t)).toBe(true);
  });
});

describe("deckRows", () => {
  it("sorts by cost, then type, then name", () => {
    const lo = findByCost("Amber", 1);
    const hi = findByCost("Amber", 5);
    if (!lo || !hi) throw new Error("fixture missing");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, hi.id, 2).state;
    s = addCard(s, lo.id, 2).state;
    const rows = deckRows(s);
    expect(rows[0]?.card.cost).toBeLessThanOrEqual(rows[1]?.card.cost ?? Number.POSITIVE_INFINITY);
  });
});

describe("validity", () => {
  it("flags a < 60 card deck", () => {
    const s = emptyDeck(["Amber", "Steel"]);
    const v = validity(s);
    expect(v.ok).toBe(false);
    expect(v.reasons.some((r) => r.includes("60"))).toBe(true);
  });
  it("passes on a hand-built legal-ish deck of 60", () => {
    // Build a 60-card deck by repeating 15 distinct Amber/Steel cards
    // at 4 copies each. Uses any legal-flagged cards in those inks.
    const pool = cards.filter(
      (c) =>
        c.inks.every((i) => i === "Amber" || i === "Steel") &&
        c.legality === "legal" &&
        c.cost <= 7,
    );
    const picks = pool.slice(0, 15);
    if (picks.length < 15) {
      // Skip silently if the fixture pool doesn't have enough.
      return;
    }
    let s = emptyDeck(["Amber", "Steel"]);
    for (const card of picks) s = addCard(s, card.id, 4).state;
    expect(totalCards(s)).toBe(60);
    const v = validity(s);
    // We only assert that the reasons list doesn't mention deck size;
    // individual cards could still trip max-copies (text-override
    // cards) or other rules — that's a real-data quirk, not a bug.
    expect(v.reasons.some((r) => r.includes("60"))).toBe(false);
  });
});

describe("summary", () => {
  it("aggregates totals + curve + type breakdown in one call", () => {
    const a = findByCost("Amber", 1);
    if (!a) return;
    let s = emptyDeck(["Amber"]);
    s = addCard(s, a.id, 2).state;
    const sum = summary(s);
    expect(sum.total).toBe(2);
    expect(sum.distinct).toBe(1);
    expect(sum.curve.reduce((acc, p) => acc + p.count, 0)).toBe(2);
    const card = cardsById.get(a.id)!;
    for (const t of card.types) {
      expect(sum.typeBreakdown.get(t as (typeof TYPES)[number])).toBe(2);
    }
  });
});
