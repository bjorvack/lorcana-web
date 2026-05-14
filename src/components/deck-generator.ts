/**
 * <deck-generator> — "Generate a deck for me" affordance.
 *
 * Reads the inks the user picked + the cards they've already added,
 * sends them to the inference worker, and applies the resulting full
 * deck back into the deck store. Surfaces a Style dropdown so users
 * can sweep from Safe (meta-faithful) to Brew (exploratory).
 *
 * Lazy by design: the model bundle (~30 MB) only downloads the first
 * time the user clicks Generate. Subsequent generations re-use the
 * already-loaded worker.
 */

import { computeMaxCopies, type CardT, type InkT } from "@bjorvack/lorcana-schemas";

import { cardsById } from "../data/cards";
import { loadModelBundle } from "../model/bundle";
import { loadVocabMap, type VocabMap } from "../model/vocab";
import { addCard, clearDeck } from "../state/deck";
import { deckStore } from "../state/index";
import { totalCards } from "../state/selectors";
import { InferenceClient } from "../worker/client";
import type { GenerateProgressEvent, StyleName } from "../worker/protocol";

const TAG = "deck-generator";

// Title-case so the comparison against `state.inks` (which is typed
// to `InkT` from the schema and uses the title-case enum values)
// produces real matches. Order is the canonical training-pipeline
// ordering — must match cards.features._INKS lowercased.
const INK_ORDER = ["Amber", "Amethyst", "Emerald", "Ruby", "Sapphire", "Steel"] as const;

type Phase = "idle" | "loading-model" | "ready" | "generating" | "done" | "error";

export class DeckGenerator extends HTMLElement {
  #client: InferenceClient | null = null;
  #vocab: VocabMap | null = null;
  #phase: Phase = "idle";
  #progressMessage = "";
  #errorMessage = "";
  #lastRealism: number | null = null;

  connectedCallback(): void {
    this.render();
    this.querySelector<HTMLButtonElement>('[data-role="generate"]')?.addEventListener(
      "click",
      () => void this.handleGenerate(),
    );
  }

  private async handleGenerate(): Promise<void> {
    const style = (this.querySelector<HTMLSelectElement>('[data-role="style"]')?.value ??
      "balanced") as StyleName;
    const state = deckStore.get();
    if (state.inks.length === 0) {
      this.setPhase("error", { error: "Pick at least one ink first." });
      return;
    }
    try {
      this.setPhase("loading-model", { progress: "Downloading model bundle (~30 MB)…" });
      // Lazy init on the first call: load + spawn worker + push bundle.
      if (!this.#client) {
        const [bundle, vocab] = await Promise.all([loadModelBundle(), loadVocabMap()]);
        this.#vocab = vocab;
        this.#client = new InferenceClient();
        this.#client.addEventListener("progress", (ev) => {
          const { detail } = ev as CustomEvent<GenerateProgressEvent>;
          this.setPhase("generating", {
            progress: `Picking card ${detail.currentSize} / ${detail.targetSize}…`,
          });
        });
        this.setPhase("loading-model", { progress: "Loading ONNX sessions…" });
        await this.#client.init(bundle);
      }
      if (!this.#vocab) this.#vocab = await loadVocabMap();

      // Map the user's partial (printing ids) to logical indices.
      const partial: [number, number][] = [];
      for (const [printingId, count] of state.cards) {
        const logical = this.#vocab.printingToLogical.get(printingId);
        if (logical !== undefined) partial.push([logical, count]);
      }

      // 6-dim ink multi-hot in the canonical order the model expects.
      const inkMultihot = INK_ORDER.map((name) =>
        state.inks.includes(name) ? 1 : 0,
      ) as unknown as readonly [number, number, number, number, number, number];

      // Vocab-aligned legality mask the worker enforces hard-rule.
      // The main thread is the only side that has the authoritative
      // ``Card.inks`` for every printing, so the per-card "would
      // addCard accept this?" check lives here. The worker treats a
      // zero entry as excluded, so we can't lose cards to silent
      // out-of-ink rejection downstream.
      const legalLogicalIds = buildLegalLogicalIds(this.#vocab, state.inks);

      this.setPhase("generating", { progress: "Calling the model…" });
      // Lorcana's actual rule is "at least 60 cards"; tournament-grade
      // decks routinely run a few over to widen the pool for searches.
      // We aim a bit over so silent rejections (e.g. a card whose ink
      // entry is unknown to the vocab) still leave us above 60.
      const { deck, realism } = await this.#client.generate({
        partial,
        inkMultihot,
        style,
        legalLogicalIds,
        targetSize: 60,
      });

      // Replace the deck wholesale: the model's pick set is the new
      // truth. Locked rows are *not* preserved yet; that's a follow-up
      // (deck-state needs an "addCardsBatch" reducer + a lock-aware
      // generate path).
      this.applyGeneratedDeck(deck);
      this.#lastRealism = realism;
      this.setPhase("done", { progress: `Done. Realism ${(realism * 100).toFixed(0)}%.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setPhase("error", { error: msg });
    }
  }

  private applyGeneratedDeck(deck: ReadonlyArray<readonly [number, number]>): void {
    if (!this.#vocab) return;
    // Wipe the deck then add each pick — keeps the addCard reducer
    // doing its max-copies/ink-validity checks rather than bypassing
    // them with a raw setState. Inefficient for big batches but
    // correctness > speed at 60 entries.
    deckStore.update((state) => {
      let next = clearDeck(state).state;
      for (const [logicalIndex, count] of deck) {
        const printingId = this.#vocab!.logicalToCanonical.get(logicalIndex);
        if (!printingId) continue;
        const card: CardT | undefined = cardsById.get(printingId);
        if (!card) continue;
        const cap = Math.min(count, computeMaxCopies(card));
        if (cap > 0) {
          next = addCard(next, printingId, cap).state;
        }
      }
      return next;
    });
  }

  private setPhase(phase: Phase, opts: { progress?: string; error?: string } = {}): void {
    this.#phase = phase;
    if (opts.progress !== undefined) this.#progressMessage = opts.progress;
    if (opts.error !== undefined) this.#errorMessage = opts.error;
    this.updateView();
  }

  private updateView(): void {
    const btn = this.querySelector<HTMLButtonElement>('[data-role="generate"]');
    if (btn) {
      btn.disabled = this.#phase === "loading-model" || this.#phase === "generating";
      btn.textContent = this.#phase === "generating" ? "Generating…" : "Generate deck";
    }
    const status = this.querySelector<HTMLElement>('[data-role="status"]');
    if (status) {
      if (this.#phase === "error") {
        status.textContent = `⚠ ${this.#errorMessage}`;
        status.classList.add("error");
      } else {
        status.textContent = this.#progressMessage;
        status.classList.remove("error");
      }
    }
  }

  private render(): void {
    const total = totalCards(deckStore.get());
    this.innerHTML = `
      <div class="deck-generator">
        <label class="generator-style">
          Style
          <select data-role="style">
            <option value="safe">Safe (meta)</option>
            <option value="balanced" selected>Balanced</option>
            <option value="brew">Brew (exploratory)</option>
          </select>
        </label>
        <button class="primary" data-role="generate">
          Generate deck
        </button>
        <span class="generator-status" data-role="status"></span>
        <span class="generator-prefill" aria-hidden="true">
          ${total > 0 ? `(${total} pre-picked cards will be kept as a seed)` : ""}
        </span>
      </div>
    `;
  }
}

/**
 * Build the vocab-aligned legality mask passed to the worker.
 *
 * For each logical card in the vocab, we look up its canonical
 * printing in ``cardsById`` and mark it legal iff every ink the card
 * carries is one of the deck's chosen inks. That's the same rule
 * ``addCard`` uses on the deck store side, so cards that survive the
 * mask are guaranteed to land in the deck rather than being silently
 * rejected.
 */
function buildLegalLogicalIds(vocab: VocabMap, deckInks: readonly InkT[]): Uint8Array {
  // +1 for the PAD slot at index 0; we never set it to 1.
  const vocabSize = vocab.entries.length;
  const out = new Uint8Array(vocabSize);
  const inkSet = new Set(deckInks);
  for (const entry of vocab.entries) {
    if (entry.index <= 0 || entry.index >= vocabSize) continue;
    const card = cardsById.get(entry.canonicalPrintingId);
    if (!card) continue;
    if (card.inks.every((i) => inkSet.has(i))) {
      out[entry.index] = 1;
    }
  }
  return out;
}

if (!customElements.get(TAG)) customElements.define(TAG, DeckGenerator);
