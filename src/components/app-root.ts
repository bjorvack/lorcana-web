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
import { clearDeck, setInks } from "../state/deck";
import { deckStore } from "../state/index";
import { totalCards } from "../state/selectors";
import { buildHash } from "../state/url";
import { VERSION } from "../version";
import "./card-finder";
import "./deck-list";
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

    this.#unsubscribe = deckStore.subscribe((state) => {
      this.updateDeckCount(totalCards(state));
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
  }

  private handleInksChanged = (event: Event): void => {
    const inks = (event as CustomEvent<{ inks: InkT[] }>).detail.inks;
    deckStore.update((state) => setInks(state, inks).state);
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

      <div class="action-bar">
        <ink-selector></ink-selector>
        <span style="flex: 1"></span>
        <button class="secondary" disabled title="Coming in the next commit">Export</button>
        <button class="ghost" data-role="clear-deck">Clear deck</button>
      </div>

      <div class="workspace">
        <section class="panel" aria-labelledby="deck-heading">
          <header>
            <h2 id="deck-heading">Deck</h2>
            <span class="count" data-role="deck-count">${totalCards(deckStore.get())} / 60</span>
          </header>
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
