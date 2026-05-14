/**
 * <type-breakdown> — small chip row showing how many of each card type
 * are in the deck (Character, Action, Song, Item, Location).
 *
 * Lighter-weight than the mana curve: a single line of "Type N" chips
 * that hide themselves when their count is zero so an early deck
 * doesn't show empty buckets.
 */

import { deckStore } from "../state/index";
import { typeBreakdown, TYPES, type CardType } from "../state/selectors";

const TAG = "type-breakdown";

const ABBR: Record<CardType, string> = {
  Character: "Char",
  Action: "Action",
  Song: "Song",
  Item: "Item",
  Location: "Loc",
};

export class TypeBreakdown extends HTMLElement {
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = deckStore.subscribe(() => this.render());
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
  }

  private render(): void {
    const counts = typeBreakdown(deckStore.get());
    const chips = TYPES.filter((t) => (counts.get(t) ?? 0) > 0)
      .map(
        (t) =>
          `<span class="type-chip" title="${t}"><span class="type-chip-count">${counts.get(t)}</span> ${ABBR[t]}</span>`,
      )
      .join("");
    this.innerHTML = chips || `<span class="type-chip-empty">No cards yet</span>`;
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, TypeBreakdown);
