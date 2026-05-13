import { describe, expect, it } from "vitest";
import { createStore } from "../src/state/store.js";

describe("createStore", () => {
  it("notifies subscribers on set", () => {
    const store = createStore({ count: 0 });
    let last = store.get();
    store.subscribe((s) => (last = s));
    store.set({ count: 1 });
    expect(last.count).toBe(1);
  });
});
