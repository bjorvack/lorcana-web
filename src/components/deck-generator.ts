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
import { isLegalNow, type Format } from "../data/legality";
import { loadModelBundle } from "../model/bundle";
import { loadVocabMap, type VocabMap } from "../model/vocab";
import { addCard, clearDeck, toggleLock } from "../state/deck";
import { generationStore } from "../state/generation";
import { deckStore } from "../state/index";
import { totalCards } from "../state/selectors";
import { InferenceClient } from "../worker/client";
import type { GenerateProgressEvent } from "../worker/protocol";

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
  #hasGeneratedThisSession = false;
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    this.querySelector<HTMLButtonElement>('[data-role="generate"]')?.addEventListener(
      "click",
      () => void this.handleGenerate(),
    );
    // Refresh the discoverability hint as the deck grows / shrinks.
    this.#unsubscribe = deckStore.subscribe(() => this.refreshHint());
    this.refreshHint();
    this.querySelector<HTMLButtonElement>('[data-role="hint-dismiss"]')?.addEventListener(
      "click",
      () => {
        try {
          localStorage.setItem("lorcana:hint:generate:dismissed", "1");
        } catch {
          // Quota / disabled / private mode — the hint just shows
          // again next visit, no functional harm.
        }
        this.refreshHint();
      },
    );
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
  }

  private refreshHint(): void {
    const hint = this.querySelector<HTMLElement>('[data-role="hint"]');
    if (!hint) return;
    const total = totalCards(deckStore.get());
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("lorcana:hint:generate:dismissed") === "1";
    } catch {
      // No storage → assume not dismissed; the user gets the hint
      // exactly once per session.
    }
    const show = !dismissed && !this.#hasGeneratedThisSession && total > 0 && total < 60;
    hint.hidden = !show;
  }

  private async handleGenerate(): Promise<void> {
    // Slider is a 0..100 integer; the worker accepts a 0..1 float.
    const rawSlider = Number(
      this.querySelector<HTMLInputElement>('[data-role="style"]')?.value ?? 50,
    );
    const style = Math.max(0, Math.min(1, rawSlider / 100));
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
      // Locked rows go into the partial too; the model conditions
      // on them and the post-pass below restores the lock flags so
      // a Generate click never displaces a card the user pinned.
      const partial: [number, number][] = [];
      for (const [printingId, count] of state.cards) {
        const logical = this.#vocab.printingToLogical.get(printingId);
        if (logical !== undefined) partial.push([logical, count]);
      }
      const lockedPrintingIds = new Set(state.locks);

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
      const legalLogicalIds = buildLegalLogicalIds(this.#vocab, state.inks, state.format);

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
      // truth. Locks are preserved across the swap: anything the user
      // pinned before Generate stays pinned after (and was already
      // in the model's partial, so its count is guaranteed to be at
      // least its locked count).
      this.applyGeneratedDeck(deck, lockedPrintingIds);
      this.#lastRealism = realism;
      // ``generationStore`` clears itself on the next deck mutation
      // (see ``state/generation.ts``), so publishing here is safe
      // even though ``applyGeneratedDeck`` triggers a store update.
      generationStore.set({ lastRealism: realism });
      this.#hasGeneratedThisSession = true;
      this.refreshHint();
      this.setPhase("done", { progress: `Done. Realism ${(realism * 100).toFixed(0)}%.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setPhase("error", { error: msg });
    }
  }

  private applyGeneratedDeck(
    deck: ReadonlyArray<readonly [number, number]>,
    lockedPrintingIds: ReadonlySet<string>,
  ): void {
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
      // Restore locks for any pinned printing that survived the
      // regenerate. ``toggleLock`` is a no-op for cards not in the
      // current deck, so a lock on a card the model dropped is
      // silently lost — that's fine, locks were a per-card pin and
      // the card is no longer here. The common case (locked card
      // was in the partial seed → model kept it → lock restored)
      // is what makes this a true preservation.
      for (const printingId of lockedPrintingIds) {
        if (next.cards.has(printingId)) {
          next = toggleLock(next, printingId).state;
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
          <span class="generator-style-label">
            <span aria-hidden="true">Safe</span>
            <span class="visually-hidden">Style</span>
            <span aria-hidden="true">Brew</span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value="50"
            data-role="style"
            aria-label="Style: 0 is Safe (meta-faithful), 100 is Brew (exploratory)"
          />
        </label>
        <button class="primary" data-role="generate">Generate deck</button>
        <span class="generator-status" data-role="status"></span>
        <span class="generator-prefill" aria-hidden="true">
          ${total > 0 ? `(${total} pre-picked cards will be kept as a seed)` : ""}
        </span>
        <span class="generator-hint" data-role="hint" hidden role="status">
          <span class="generator-hint-body">Generate can fill in the gaps from your seed →</span>
          <button
            class="ghost"
            type="button"
            data-role="hint-dismiss"
            aria-label="Dismiss hint"
          >×</button>
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
function buildLegalLogicalIds(
  vocab: VocabMap,
  deckInks: readonly InkT[],
  format: Format,
): Uint8Array {
  // +1 for the PAD slot at index 0; we never set it to 1.
  const vocabSize = vocab.entries.length;
  const out = new Uint8Array(vocabSize);
  const inkSet = new Set(deckInks);
  for (const entry of vocab.entries) {
    if (entry.index <= 0 || entry.index >= vocabSize) continue;
    const card = cardsById.get(entry.canonicalPrintingId);
    if (!card) continue;
    if (!card.inks.every((i) => inkSet.has(i))) continue;
    // Intersect with the active format's legal set so the model
    // never proposes a banned / rotated-out / unreleased card.
    if (!isLegalNow(card, format)) continue;
    out[entry.index] = 1;
  }
  return out;
}

if (!customElements.get(TAG)) customElements.define(TAG, DeckGenerator);
