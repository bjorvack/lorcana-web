/**
 * AI subsystem health state.
 *
 * Tracks whether the inference worker is healthy enough for AI
 * features to work. Lives outside the deck store because it's purely
 * a UI / availability flag — no deck reducer cares about it.
 *
 * Three states:
 *   - ``idle``  — model hasn't been touched yet. Generate button works.
 *   - ``ok``    — worker is up; live realism + Generate available.
 *   - ``failed``— init crashed (network 404, ORT init blew up, WASM
 *                 + WebGPU both unsupported, …). Generate is disabled,
 *                 a banner with Retry is shown, live scoring is paused.
 *
 * Per DESIGN Q5: "AI features are a single coordinated state: **on**
 * or **off**. When off, …all are disabled (greyed, not hidden).
 * Manual building, card finder, mana curve, type breakdown, and deck
 * list are unaffected."
 */

import { createStore, type Store } from "./store";

export type AIStatus = "idle" | "ok" | "failed";

export interface AIState {
  readonly status: AIStatus;
  readonly errorMessage?: string;
}

export const aiStore: Store<AIState> = createStore<AIState>({ status: "idle" });

export function setAIOk(): void {
  if (aiStore.get().status !== "ok") aiStore.set({ status: "ok" });
}

export function setAIFailed(message: string): void {
  aiStore.set({ status: "failed", errorMessage: message });
}

export function setAIIdle(): void {
  aiStore.set({ status: "idle" });
}
