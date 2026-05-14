/**
 * <deck-export> — copies the current deck to clipboard or opens it
 * in inktable.net's deck importer.
 *
 * Two affordances:
 *
 * - **Copy plaintext** — drops "4 Card Name - Version" lines on the
 *   clipboard. Friendly for inktable's paste import, Inkwell NZ,
 *   Cockatrice-style importers, and anything that accepts a flat
 *   decklist.
 * - **Open in Inktable** — encodes the deck into Inktable's
 *   ``svc=dreamborn`` URL scheme and opens it in a new tab.
 *
 * Inactive when the deck is empty so users don't share blanks by
 * accident. Status messages live next to the buttons and clear
 * themselves after a couple of seconds.
 */

import { cardsById } from "../data/cards";
import { deckStore } from "../state/index";
import { buildExportEntries, buildPlaintextDecklist, inktableImportUrl } from "../utils/inktable";

const TAG = "deck-export";
const STATUS_CLEAR_MS = 2500;

export class DeckExport extends HTMLElement {
  #unsubscribe?: () => void;
  #statusTimeout: ReturnType<typeof setTimeout> | null = null;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = deckStore.subscribe(() => this.syncEnabled());
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
    if (this.#statusTimeout) clearTimeout(this.#statusTimeout);
  }

  private deckName(): string {
    const inks = deckStore.get().inks;
    return inks.length > 0 ? `Lorcana deck — ${inks.join(" / ")}` : "Lorcana deck";
  }

  private async copyPlaintext(): Promise<void> {
    const state = deckStore.get();
    const entries = buildExportEntries(state.cards, cardsById);
    if (entries.length === 0) return;
    try {
      await navigator.clipboard.writeText(buildPlaintextDecklist(entries));
      this.setStatus(`Copied ${totalEntries(entries)} cards to clipboard.`);
    } catch {
      // Clipboard is gated behind a user gesture + permission; if it
      // fails we degrade to a textarea-prompt that the user can copy
      // manually rather than silently swallowing the error.
      this.setStatus("Clipboard blocked — see browser permissions.", "error");
    }
  }

  private async copyShareUrl(): Promise<void> {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      this.setStatus("Share link copied.");
    } catch {
      this.setStatus("Clipboard blocked — see browser permissions.", "error");
    }
  }

  private openInInktable(): void {
    const state = deckStore.get();
    const entries = buildExportEntries(state.cards, cardsById);
    if (entries.length === 0) return;
    const url = inktableImportUrl(entries, this.deckName());
    window.open(url, "_blank", "noopener,noreferrer");
    this.setStatus("Opening in inktable.net…");
  }

  private setStatus(text: string, kind: "info" | "error" = "info"): void {
    const status = this.querySelector<HTMLElement>('[data-role="export-status"]');
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("error", kind === "error");
    if (this.#statusTimeout) clearTimeout(this.#statusTimeout);
    this.#statusTimeout = setTimeout(() => {
      status.textContent = "";
      status.classList.remove("error");
    }, STATUS_CLEAR_MS);
  }

  private syncEnabled(): void {
    const empty = deckStore.get().cards.size === 0;
    // ``share`` works on an empty deck too (link still encodes the
    // ink selection); only the deck-only exports require content.
    for (const btn of this.querySelectorAll<HTMLButtonElement>("button[data-export]")) {
      const role = btn.dataset.export;
      btn.disabled = role !== "share" && empty;
    }
  }

  private render(): void {
    this.innerHTML = `
      <div class="deck-export">
        <button class="secondary" data-export="share" type="button">Share link</button>
        <button class="secondary" data-export="plaintext" type="button">Copy decklist</button>
        <button class="secondary" data-export="inktable" type="button">Open in Inktable</button>
        <span class="export-status" data-role="export-status" aria-live="polite"></span>
      </div>
    `;
    this.querySelector<HTMLButtonElement>('[data-export="share"]')?.addEventListener(
      "click",
      () => void this.copyShareUrl(),
    );
    this.querySelector<HTMLButtonElement>('[data-export="plaintext"]')?.addEventListener(
      "click",
      () => void this.copyPlaintext(),
    );
    this.querySelector<HTMLButtonElement>('[data-export="inktable"]')?.addEventListener(
      "click",
      () => this.openInInktable(),
    );
    this.syncEnabled();
  }
}

function totalEntries(entries: ReadonlyArray<{ count: number }>): number {
  return entries.reduce((acc, e) => acc + e.count, 0);
}

if (!customElements.get(TAG)) customElements.define(TAG, DeckExport);
