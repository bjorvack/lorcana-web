/**
 * Pure-reducer tests for the deck state machine. No DOM, no store —
 * we exercise the reducers directly so failures point at the exact
 * invariant the change broke.
 */

import { describe, expect, it } from "vitest";

import { cards } from "../src/data/cards";
import {
  addCard,
  clearDeck,
  emptyDeck,
  removeCard,
  setCount,
  setInks,
  toggleLock,
} from "../src/state/deck";

// Real card-pool fixtures keep the tests grounded in actual data,
// while a couple of focused helpers find ids by name so renumbering
// of `crd_…` ids in a future cards-vN doesn't break the suite.
function findByName(name: string, version?: string): string {
  const c = cards.find((x) => x.name === name && (!version || x.version === version));
  if (!c) throw new Error(`fixture not found: ${name}${version ? ` - ${version}` : ""}`);
  return c.id;
}

function findFirstInk(
  ink: "Amber" | "Amethyst" | "Emerald" | "Ruby" | "Sapphire" | "Steel",
): string {
  const c = cards.find((x) => x.inks.length === 1 && x.inks[0] === ink);
  if (!c) throw new Error(`no single-${ink} card in the pool`);
  return c.id;
}

describe("emptyDeck", () => {
  it("starts with no cards and no locks", () => {
    const d = emptyDeck();
    expect(d.cards.size).toBe(0);
    expect(d.locks.size).toBe(0);
    expect(d.inks).toEqual(["Amber", "Steel"]);
  });
  it("rejects invalid ink lengths", () => {
    expect(() => emptyDeck([])).toThrow();
    expect(() => emptyDeck(["Amber", "Steel", "Ruby"] as never)).toThrow();
  });
});

describe("addCard", () => {
  it("adds a card that fits the inks", () => {
    const amber = findFirstInk("Amber");
    const { state, warnings } = addCard(emptyDeck(["Amber", "Steel"]), amber, 4);
    expect(state.cards.get(amber)).toBe(4);
    expect(warnings).toEqual([]);
  });
  it("rejects a card outside the inks with a warning", () => {
    const ruby = findFirstInk("Ruby");
    const { state, warnings } = addCard(emptyDeck(["Amber", "Steel"]), ruby);
    expect(state.cards.size).toBe(0);
    expect(warnings[0]).toMatch(/outside the chosen inks/);
  });
  it("clamps at computeMaxCopies (4 for most cards)", () => {
    const amber = findFirstInk("Amber");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, amber, 5).state; // overshoot the 4 cap
    expect(s.cards.get(amber)).toBe(4);
    const tryAgain = addCard(s, amber);
    expect(tryAgain.state.cards.get(amber)).toBe(4);
    expect(tryAgain.warnings[0]).toMatch(/4-copy cap/);
  });
  it("warns on an unknown card id but leaves state alone", () => {
    const before = emptyDeck();
    const { state, warnings } = addCard(before, "crd_not_real");
    expect(state).toBe(before);
    expect(warnings[0]).toMatch(/Unknown card id/);
  });
});

describe("removeCard", () => {
  it("decrements existing counts", () => {
    const amber = findFirstInk("Amber");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, amber, 3).state;
    s = removeCard(s, amber).state;
    expect(s.cards.get(amber)).toBe(2);
  });
  it("deletes the entry on the last copy + releases the lock", () => {
    const amber = findFirstInk("Amber");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, amber, 1).state;
    s = toggleLock(s, amber).state;
    expect(s.locks.has(amber)).toBe(true);
    s = removeCard(s, amber).state;
    expect(s.cards.has(amber)).toBe(false);
    expect(s.locks.has(amber)).toBe(false);
  });
});

describe("setCount", () => {
  it("zero clears the card", () => {
    const amber = findFirstInk("Amber");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, amber, 4).state;
    s = setCount(s, amber, 0).state;
    expect(s.cards.has(amber)).toBe(false);
  });
  it("clamps at the cap with a warning", () => {
    const amber = findFirstInk("Amber");
    const { state, warnings } = setCount(emptyDeck(["Amber", "Steel"]), amber, 99);
    expect(state.cards.get(amber)).toBe(4);
    expect(warnings[0]).toMatch(/capped at 4/);
  });
});

describe("toggleLock", () => {
  it("ignores locking a card that isn't in the deck", () => {
    const amber = findFirstInk("Amber");
    const { state, warnings } = toggleLock(emptyDeck(["Amber"]), amber);
    expect(state.locks.size).toBe(0);
    expect(warnings[0]).toMatch(/Can't lock/);
  });
  it("toggles on then off", () => {
    const amber = findFirstInk("Amber");
    let s = addCard(emptyDeck(["Amber"]), amber, 2).state;
    s = toggleLock(s, amber).state;
    expect(s.locks.has(amber)).toBe(true);
    s = toggleLock(s, amber).state;
    expect(s.locks.has(amber)).toBe(false);
  });
});

describe("setInks", () => {
  it("evicts cards outside the new inks", () => {
    const amber = findFirstInk("Amber");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, amber, 4).state;
    const next = setInks(s, ["Ruby", "Sapphire"]);
    expect(next.state.cards.size).toBe(0);
    expect(next.warnings[0]).toMatch(/Removed 1 card/);
  });
  it("keeps cards that still fit", () => {
    const amber = findFirstInk("Amber");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, amber, 2).state;
    const next = setInks(s, ["Amber", "Ruby"]);
    expect(next.state.cards.get(amber)).toBe(2);
    expect(next.warnings).toEqual([]);
  });
});

describe("clearDeck", () => {
  it("keeps inks but empties cards + locks", () => {
    const amber = findFirstInk("Amber");
    let s = emptyDeck(["Amber", "Steel"]);
    s = addCard(s, amber, 4).state;
    s = toggleLock(s, amber).state;
    s = clearDeck(s).state;
    expect(s.cards.size).toBe(0);
    expect(s.locks.size).toBe(0);
    expect(s.inks).toEqual(["Amber", "Steel"]);
  });
});

// Suppress unused-warning while keeping the helper alongside its sibling.
void findByName;
