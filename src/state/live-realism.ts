/**
 * Live realism scoring: re-score the deck whenever it changes,
 * debounced so a rapid edit (e.g. holding the +/- stepper) only
 * fires one evaluator call.
 *
 * Only active once the user has triggered the first Generate — until
 * then, the model bundle isn't loaded and we don't want this code to
 * trigger a 30 MB download in the background. ``peekInference`` is
 * the cheap "is there a live worker?" check.
 *
 * Scoring is paused while a Generate is in flight: ``isGenerating``
 * is a tiny flag the deck-generator flips on/off. Without it, a
 * stale score for the partial seed would land on top of the real
 * post-Generate score.
 */

import { peekInference } from "../model/inference-singleton";
import { deckStore } from "./index";
import { generationStore } from "./generation";

const DEBOUNCE_MS = 300;

let timer: ReturnType<typeof setTimeout> | null = null;
let generating = false;
let pending = false;
let lastFingerprint = "";

function fingerprint(cards: ReadonlyMap<string, number>): string {
  const parts: string[] = [];
  for (const [id, count] of cards) parts.push(`${id}:${count}`);
  return parts.join(",");
}

async function runScore(): Promise<void> {
  const inf = peekInference();
  if (!inf) return;
  const state = deckStore.get();
  if (state.cards.size === 0) {
    // Nothing to score; clear any stale value.
    if (generationStore.get().lastRealism !== null) {
      generationStore.set({ lastRealism: null, scoring: false });
    }
    return;
  }
  const fp = fingerprint(state.cards);
  if (fp === lastFingerprint && generationStore.get().lastRealism !== null) return;
  pending = true;
  generationStore.set({ ...generationStore.get(), scoring: true });
  try {
    // Translate printing ids → logical ids the worker expects.
    const cards: [number, number][] = [];
    for (const [printingId, count] of state.cards) {
      const logical = inf.vocab.printingToLogical.get(printingId);
      if (logical !== undefined) cards.push([logical, count]);
    }
    if (cards.length === 0) {
      generationStore.set({ lastRealism: null, scoring: false });
      return;
    }
    const realism = await inf.client.score(cards);
    lastFingerprint = fp;
    generationStore.set({ lastRealism: realism, scoring: false });
  } catch {
    // Non-fatal: keep the previous score, drop the spinner.
    generationStore.set({ ...generationStore.get(), scoring: false });
  } finally {
    pending = false;
  }
}

/**
 * Idempotent. The deck-generator calls this once after a successful
 * model load so the worker isn't downloaded prematurely.
 */
export function startLiveRealism(): void {
  if (timer) return;
  // Initial debounce armed lazily so the first call doesn't fire
  // until the user touches the deck.
  deckStore.subscribe(() => schedule());
}

/** Called by the deck-generator around its Generate run. */
export function setGenerating(g: boolean): void {
  generating = g;
  if (!g) schedule();
}

function schedule(): void {
  if (generating || pending) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runScore();
  }, DEBOUNCE_MS);
}
