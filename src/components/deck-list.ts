/**
 * <deck-list> — the user's deck, grouped by type.
 *
 * Subscribes to the store and re-renders on every change. Within a
 * type, rows are sorted cost ascending then name (same ordering as
 * the finder, so the eye doesn't recalibrate). Each row has +/- /
 * lock controls that dispatch the appropriate reducer.
 *
 * Empty deck shows the same "pick inks then start adding" hint as
 * the panel's outer empty-state — feels like one continuous
 * affordance to the user.
 */

import { cardLegality, type Format } from "../data/legality";
import { removeCard, setCount, toggleLock } from "../state/deck";
import { deckStore } from "../state/index";
import { type CardType, type DeckRow, TYPES, deckRows } from "../state/selectors";
import { bindImageFallback } from "../utils/card-image";
import { buildLegalityDot } from "./card-finder";
import { bindPreviewTrigger } from "./card-preview";

const TAG = "deck-list";

const INK_VAR: Record<string, string> = {
  Amber: "var(--ink-amber)",
  Amethyst: "var(--ink-amethyst)",
  Emerald: "var(--ink-emerald)",
  Ruby: "var(--ink-ruby)",
  Sapphire: "var(--ink-sapphire)",
  Steel: "var(--ink-steel)",
};

export class DeckList extends HTMLElement {
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = deckStore.subscribe(() => this.render());
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
  }

  private render(): void {
    const state = deckStore.get();
    const rows = deckRows(state);
    if (rows.length === 0) {
      this.innerHTML = `
        <div class="empty-state">
          <p>Add cards from the finder to start building your deck.</p>
        </div>
      `;
      return;
    }

    const grouped = groupByType(rows);
    const container = document.createElement("div");
    container.className = "deck-groups";

    for (const type of TYPES) {
      const group = grouped.get(type) ?? [];
      if (group.length === 0) continue;
      container.append(buildGroup(type, group, state.format));
    }
    this.replaceChildren(container);
  }
}

function groupByType(rows: readonly DeckRow[]): Map<CardType, DeckRow[]> {
  const out = new Map<CardType, DeckRow[]>();
  for (const row of rows) {
    for (const type of row.card.types) {
      if (!(TYPES as readonly string[]).includes(type)) continue;
      const t = type as CardType;
      const list = out.get(t) ?? [];
      list.push(row);
      out.set(t, list);
    }
  }
  return out;
}

function buildGroup(type: CardType, rows: readonly DeckRow[], format: Format): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "deck-group";

  const heading = document.createElement("h3");
  heading.className = "deck-group-heading";
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  heading.innerHTML = `<span>${type}</span><span class="count">${total}</span>`;
  wrap.append(heading);

  const ul = document.createElement("ul");
  ul.className = "deck-rows";
  ul.setAttribute("role", "list");
  for (const row of rows) ul.append(buildRow(row, format));
  wrap.append(ul);

  return wrap;
}

function buildRow(row: DeckRow, format: Format): HTMLElement {
  const li = document.createElement("li");
  li.className = "deck-row";

  // Thumbnail of the specific printing the user added. Lazy-loaded so
  // tall decks don't blast the network on first paint.
  const thumbWrap = document.createElement("span");
  thumbWrap.className = "card-row-thumb";
  const img = document.createElement("img");
  img.src = row.card.imageUrl;
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = `${row.card.name}${row.card.version ? ` — ${row.card.version}` : ""}`;
  bindImageFallback(img, img.alt);
  thumbWrap.append(img);

  const countCtrl = document.createElement("span");
  countCtrl.className = "deck-row-count";
  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "ghost step";
  minus.textContent = "−";
  minus.setAttribute("aria-label", `Remove one ${row.card.name}`);
  minus.addEventListener("click", () =>
    deckStore.update((state) => removeCard(state, row.card.id, 1).state),
  );
  const countText = document.createElement("span");
  countText.className = "count-text";
  countText.textContent = String(row.count);
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "ghost step";
  plus.textContent = "+";
  plus.setAttribute("aria-label", `Add one ${row.card.name}`);
  plus.addEventListener("click", () =>
    deckStore.update((state) => setCount(state, row.card.id, row.count + 1).state),
  );
  countCtrl.append(minus, countText, plus);

  const inkBox = document.createElement("span");
  inkBox.className = "card-row-inks";
  inkBox.setAttribute("aria-hidden", "true");
  for (const ink of row.card.inks) {
    const dot = document.createElement("span");
    dot.className = "ink-dot";
    dot.style.background = INK_VAR[ink] ?? "var(--text-muted)";
    inkBox.append(dot);
  }

  const cost = document.createElement("span");
  cost.className = "card-row-cost";
  cost.setAttribute("aria-label", `${row.card.cost} ink`);
  cost.textContent = String(row.card.cost);

  const nameLine = document.createElement("span");
  nameLine.className = "card-row-nameline";
  nameLine.append(buildLegalityDot(cardLegality(row.card, format)));
  const name = document.createElement("span");
  name.className = "card-row-name";
  name.textContent = row.card.version ? `${row.card.name} — ${row.card.version}` : row.card.name;
  nameLine.append(name);

  const lock = document.createElement("button");
  lock.type = "button";
  lock.className = "ghost lock";
  lock.setAttribute("aria-pressed", row.locked ? "true" : "false");
  lock.setAttribute("aria-label", row.locked ? `Unlock ${row.card.name}` : `Lock ${row.card.name}`);
  lock.textContent = row.locked ? "🔒" : "🔓";
  lock.addEventListener("click", () =>
    deckStore.update((state) => toggleLock(state, row.card.id).state),
  );

  li.append(countCtrl, thumbWrap, inkBox, cost, nameLine, lock);
  bindPreviewTrigger(li, row.card);
  return li;
}

if (!customElements.get(TAG)) customElements.define(TAG, DeckList);
