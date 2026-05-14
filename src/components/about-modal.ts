/**
 * <about-modal> — versions, sources, and what we send.
 *
 * Honest disclosure of pinned tags and runtime behaviour so a user
 * (or a maintainer triaging an issue) can see at a glance which
 * cards / model / schemas are baked into this deploy.
 *
 * Surfaced by a small "About" link in the header. Closes on
 * backdrop click, Escape, or the close button. Body scroll-locks
 * while open so the modal doesn't fight the page beneath.
 */

import {
  CARDS_RELEASE_TAG,
  CARD_COUNT,
  CARD_SET_VERSION,
  LEGALITY_RELEASE_TAG,
} from "../data/cards";
import { MODEL_RELEASE_TAG, VERSION } from "../version";

const TAG = "about-modal";

export class AboutModal extends HTMLElement {
  #lastFocus: Element | null = null;

  connectedCallback(): void {
    this.hidden = true;
    this.setAttribute("role", "dialog");
    this.setAttribute("aria-modal", "true");
    this.setAttribute("aria-labelledby", "about-modal-title");
    this.render();
  }

  open(): void {
    this.#lastFocus = document.activeElement;
    this.hidden = false;
    document.body.classList.add("modal-open");
    // Push focus into the modal so keyboard users land somewhere
    // sensible. Close button is a reliable target.
    this.querySelector<HTMLButtonElement>('[data-role="about-close"]')?.focus();
    document.addEventListener("keydown", this.handleKey);
  }

  close(): void {
    this.hidden = true;
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", this.handleKey);
    if (this.#lastFocus instanceof HTMLElement) this.#lastFocus.focus();
  }

  private handleKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  private render(): void {
    this.innerHTML = `
      <div class="about-backdrop" data-role="about-backdrop"></div>
      <div class="about-card">
        <header>
          <h2 id="about-modal-title">About</h2>
          <button class="ghost" data-role="about-close" aria-label="Close">×</button>
        </header>
        <section>
          <h3>This deploy</h3>
          <dl class="about-dl">
            <dt>App version</dt><dd>${escapeHtml(VERSION)}</dd>
            <dt>Card pool</dt><dd>${CARD_COUNT} cards · <code>${escapeHtml(CARDS_RELEASE_TAG)}</code></dd>
            <dt>Card-set hash</dt><dd><code>${escapeHtml(CARD_SET_VERSION)}</code></dd>
            <dt>Banlist + rotation</dt><dd><code>${escapeHtml(LEGALITY_RELEASE_TAG)}</code></dd>
            <dt>Model</dt><dd>${MODEL_RELEASE_TAG ? `<code>${escapeHtml(MODEL_RELEASE_TAG)}</code>` : "<em>(none)</em>"}</dd>
          </dl>
        </section>
        <section>
          <h3>What this site does</h3>
          <ul class="about-list">
            <li>Loads static assets from the Pages origin.</li>
            <li>Loads card art from Lorcast (cross-origin <code>&lt;img&gt;</code>).</li>
            <li>Runs inference locally in a Web Worker — no server.</li>
            <li>Stores your last-edited deck in <code>localStorage</code> so a refresh restores it.</li>
          </ul>
        </section>
        <section>
          <h3>What this site does <em>not</em> do</h3>
          <ul class="about-list">
            <li>No analytics, no Sentry, no telemetry endpoints.</li>
            <li>No accounts, no server-side deck storage.</li>
            <li>No cookies.</li>
          </ul>
        </section>
        <section>
          <h3>Source</h3>
          <ul class="about-list">
            <li><a href="https://github.com/bjorvack/lorcana-web" target="_blank" rel="noopener">lorcana-web</a> — this site</li>
            <li><a href="https://github.com/bjorvack/lorcana-schemas" target="_blank" rel="noopener">lorcana-schemas</a> — typed contracts</li>
            <li><a href="https://github.com/bjorvack/lorcana-scraper" target="_blank" rel="noopener">lorcana-scraper</a> — cards-vN + banlist + rotation</li>
            <li><a href="https://github.com/bjorvack/lorcana-training" target="_blank" rel="noopener">lorcana-training</a> — model-vN training pipeline</li>
          </ul>
        </section>
      </div>
    `;
    this.querySelector<HTMLButtonElement>('[data-role="about-close"]')?.addEventListener(
      "click",
      () => this.close(),
    );
    this.querySelector<HTMLElement>('[data-role="about-backdrop"]')?.addEventListener("click", () =>
      this.close(),
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (!customElements.get(TAG)) customElements.define(TAG, AboutModal);
