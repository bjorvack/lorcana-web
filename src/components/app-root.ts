/**
 * <app-root> — top-level shell.
 *
 * Subscribes to the deck store, mirrors changes back into the URL
 * hash for shareable links, and re-renders the regions whose
 * content depends on store state (today: the deck panel's count).
 *
 * The two child panels and the ink selector are mounted once in
 * connectedCallback; only the count badge and the deck panel are
 * re-rendered on store updates. We dodge the typical full-innerHTML
 * thrash by targeting the specific nodes that need to change.
 */

import { CARD_COUNT, CARDS_RELEASE_TAG } from "../data/cards";
import type { Format } from "../data/legality";
import { clearDeck, setFormat, setInks } from "../state/deck";
import { deckStore, initialWarnings } from "../state/index";
import { totalCards } from "../state/selectors";
import { buildHash } from "../state/url";
import { VERSION } from "../version";
import "./banner";
import type { AppBanner } from "./banner";
import "./card-finder";
import "./deck-export";
import "./deck-generator";
import "./deck-list";
import "./format-selector";
import "./mana-curve";
import "./realism-pill";
import type { FormatSelector } from "./format-selector";
// `InkSelector` is used only as a TypeScript type below, so we also
// need the side-effect import to ensure the custom element gets
// registered before <app-root> queries for it.
import "./ink-selector";
import type { InkSelector } from "./ink-selector";

import type { InkT } from "@bjorvack/lorcana-schemas";

const TAG = "app-root";

export class AppRoot extends HTMLElement {
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    const inkSelector = this.querySelector<InkSelector>("ink-selector");
    if (inkSelector) {
      // Seed the chip selection from the store so a URL-hash-loaded
      // deck restores its inks visually.
      inkSelector.selected = deckStore.get().inks;
      inkSelector.addEventListener("inks-changed", this.handleInksChanged);
    }
    const formatSelector = this.querySelector<FormatSelector>("format-selector");
    if (formatSelector) {
      formatSelector.selected = deckStore.get().format;
      formatSelector.addEventListener("format-changed", this.handleFormatChanged);
    }
    if (initialWarnings.length > 0) {
      const banner = this.querySelector<AppBanner>("app-banner");
      banner?.showMany(initialWarnings, "warning");
    }

    this.#unsubscribe = deckStore.subscribe((state) => {
      this.updateDeckCount(totalCards(state));
      // Keep the chip pressed-state in sync when the format is
      // changed via URL hash / external means.
      const fs = this.querySelector<FormatSelector>("format-selector");
      if (fs && fs.selected !== state.format) fs.selected = state.format;
      // Reflect deck state in the URL hash without piling up history
      // entries — replaceState rather than pushState.
      const hash = buildHash(state);
      const url = `${location.pathname}${location.search}${hash}`;
      if (`${location.pathname}${location.search}${location.hash}` !== url) {
        history.replaceState(history.state, "", url);
      }
    });
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
    const inkSelector = this.querySelector<InkSelector>("ink-selector");
    inkSelector?.removeEventListener("inks-changed", this.handleInksChanged);
    const formatSelector = this.querySelector<FormatSelector>("format-selector");
    formatSelector?.removeEventListener("format-changed", this.handleFormatChanged);
  }

  private handleInksChanged = (event: Event): void => {
    const inks = (event as CustomEvent<{ inks: InkT[] }>).detail.inks;
    deckStore.update((state) => setInks(state, inks).state);
  };

  private handleFormatChanged = (event: Event): void => {
    const format = (event as CustomEvent<{ format: Format }>).detail.format;
    deckStore.update((state) => setFormat(state, format).state);
  };

  private updateDeckCount(total: number): void {
    const el = this.querySelector<HTMLElement>('[data-role="deck-count"]');
    if (el) el.textContent = `${total} / 60`;
  }

  private render(): void {
    this.innerHTML = `
      <header class="lorcana-header">
        <h1>Lorcana Deckbuilder</h1>
        <span class="meta">
          ${CARD_COUNT} cards · ${CARDS_RELEASE_TAG} · v${VERSION}
        </span>
      </header>

      <app-banner hidden></app-banner>

      <div class="action-bar">
        <ink-selector></ink-selector>
        <format-selector></format-selector>
        <span style="flex: 1"></span>
        <deck-generator></deck-generator>
        <deck-export></deck-export>
        <button class="ghost" data-role="clear-deck">Clear deck</button>
      </div>

      <div class="workspace">
        <section class="panel" aria-labelledby="deck-heading">
          <header>
            <h2 id="deck-heading">Deck</h2>
            <realism-pill hidden></realism-pill>
            <span class="count" data-role="deck-count">${totalCards(deckStore.get())} / 60</span>
          </header>
          <mana-curve></mana-curve>
          <deck-list></deck-list>
        </section>

        <section class="panel" aria-labelledby="finder-heading">
          <header>
            <h2 id="finder-heading">Card finder</h2>
          </header>
          <card-finder></card-finder>
        </section>
      </div>
    `;
    const clear = this.querySelector<HTMLButtonElement>('[data-role="clear-deck"]');
    clear?.addEventListener("click", () => {
      deckStore.update((state) => clearDeck(state).state);
    });
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, AppRoot);
