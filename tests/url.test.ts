/**
 * Round-trip + forgiving-load tests for the hash-param serialiser.
 */

import { describe, expect, it } from "vitest";

import { emptyDeck } from "../src/state/deck";
import { applyHash, buildHash, parseHash, serialiseDeck } from "../src/state/url";

function buildDeck(): ReturnType<typeof emptyDeck> {
  const state = emptyDeck(["Amber", "Sapphire"]);
  return {
    ...state,
    cards: new Map([
      ["crd_aaa111", 4],
      ["crd_bbb222", 3],
    ]),
    locks: new Set(["crd_aaa111"]),
  };
}

describe("serialiseDeck / buildHash", () => {
  it("emits ink/deck/locks params", () => {
    const s = serialiseDeck(buildDeck());
    expect(s.inks).toBe("amber-sapphire");
    expect(s.deck).toBeDefined();
    expect(s.locks).toBeDefined();
  });
  it("omits empty deck + locks", () => {
    const s = serialiseDeck(emptyDeck(["Amber", "Steel"]));
    expect(s.inks).toBe("amber-steel");
    expect(s.deck).toBeUndefined();
    expect(s.locks).toBeUndefined();
  });
  it("produces a single ink hash for a 1-ink deck", () => {
    const s = serialiseDeck(emptyDeck(["Amber"]));
    expect(s.inks).toBe("amber");
  });
});

describe("parseHash", () => {
  it("returns {} for an empty / missing hash", () => {
    expect(parseHash("")).toEqual({});
    expect(parseHash("#")).toEqual({});
  });
  it("tolerates the leading #", () => {
    expect(parseHash("#inks=amber-steel")).toEqual({ inks: "amber-steel" });
    expect(parseHash("inks=amber-steel")).toEqual({ inks: "amber-steel" });
  });
});

describe("applyHash (forgiving load)", () => {
  it("round-trips a populated deck", () => {
    const before = buildDeck();
    const hash = buildHash(before);
    const { state, warnings } = applyHash(hash);
    expect(warnings).toEqual([]);
    expect(state.inks).toEqual(before.inks);
    expect(state.cards).toEqual(before.cards);
    expect(state.locks).toEqual(before.locks);
  });
  it("falls back to default inks on a garbage string", () => {
    const { state, warnings } = applyHash("#inks=not-a-real-ink");
    expect(state.inks).toEqual(["Amber", "Steel"]);
    expect(warnings.some((w) => w.includes("inks"))).toBe(true);
  });
  it("ignores a malformed deck payload but keeps inks intact", () => {
    const { state, warnings } = applyHash("#inks=ruby-emerald&deck=$$$");
    expect(state.inks).toEqual(["Ruby", "Emerald"]);
    expect(state.cards.size).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
  it("survives a partial / empty hash", () => {
    const { state } = applyHash("");
    expect(state.inks).toEqual(["Amber", "Steel"]);
    expect(state.cards.size).toBe(0);
  });
  it("tolerates an unknown card id (loads what it can)", () => {
    // Synthesise an `id:count` entry by hand and confirm it survives
    // the encode/decode but the empty-string id is dropped.
    const fake = btoa("crd_ghost:2,:3")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const { state } = applyHash(`#inks=amber-steel&deck=${fake}`);
    expect(state.cards.get("crd_ghost")).toBe(2);
    // Empty-id slot dropped.
    expect(state.cards.has("")).toBe(false);
  });
});
