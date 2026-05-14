/**
 * localStorage persistence tests.
 *
 * Pinned because a regression here silently loses the user's deck
 * between visits, and the failure mode is invisible until they come
 * back, notice their work is gone, and stop trusting the app.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyDeck } from "../src/state/deck";
import { clearSavedDeck, loadSavedDeck, saveDeck } from "../src/state/persistence";

// JSDOM-free storage shim so the suite stays in the Node runtime.
class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  key(i: number): string | null {
    return [...this.#map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.#map.has(k) ? this.#map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.#map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.#map.delete(k);
  }
  clear(): void {
    this.#map.clear();
  }
}

beforeEach(() => {
  // Override the global so the persistence module's typeof check
  // resolves to "object".
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

afterEach(() => {
  delete (globalThis as Partial<{ localStorage: Storage }>).localStorage;
});

describe("persistence", () => {
  it("round-trips an empty deck", () => {
    saveDeck(emptyDeck(["Amber", "Steel"]));
    const restored = loadSavedDeck();
    expect(restored).not.toBeNull();
    expect(restored!.inks).toEqual(["Amber", "Steel"]);
    expect(restored!.cards.size).toBe(0);
    expect(restored!.locks.size).toBe(0);
  });

  it("round-trips deck contents + locks + format", () => {
    const base = emptyDeck(["Ruby", "Amethyst"], "infinity_constructed");
    saveDeck({
      ...base,
      cards: new Map([
        ["crd_aaa", 4],
        ["crd_bbb", 2],
      ]),
      locks: new Set(["crd_aaa"]),
    });
    const restored = loadSavedDeck()!;
    expect(restored.inks).toEqual(["Ruby", "Amethyst"]);
    expect(restored.format).toBe("infinity_constructed");
    expect([...restored.cards]).toEqual([
      ["crd_aaa", 4],
      ["crd_bbb", 2],
    ]);
    expect([...restored.locks]).toEqual(["crd_aaa"]);
  });

  it("returns null for an empty store", () => {
    expect(loadSavedDeck()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem("lorcana:deck:v1", "not-json");
    expect(loadSavedDeck()).toBeNull();
  });

  it("rejects payloads from older schema versions", () => {
    localStorage.setItem(
      "lorcana:deck:v1",
      JSON.stringify({
        version: 0,
        inks: ["Amber"],
        cards: [],
        locks: [],
        format: "core_constructed",
      }),
    );
    expect(loadSavedDeck()).toBeNull();
  });

  it("filters out bogus card entries and ink values", () => {
    localStorage.setItem(
      "lorcana:deck:v1",
      JSON.stringify({
        version: 1,
        inks: ["Amber", "Bogus", "Steel"],
        cards: [
          ["crd_ok", 3],
          ["", 4],
          ["crd_negative", -1],
          ["crd_string_count", "x"],
        ],
        locks: ["crd_ok", 7],
        format: "core_constructed",
      }),
    );
    const restored = loadSavedDeck()!;
    expect(restored.inks).toEqual(["Amber", "Steel"]);
    expect([...restored.cards]).toEqual([["crd_ok", 3]]);
    expect([...restored.locks]).toEqual(["crd_ok"]);
  });

  it("clearSavedDeck removes the entry", () => {
    saveDeck(emptyDeck());
    clearSavedDeck();
    expect(loadSavedDeck()).toBeNull();
  });
});
