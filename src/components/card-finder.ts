/**
 * <card-finder> — searchable, ink-constrained list of cards from the
 * pinned pool.
 *
 * Always filters to ``deck.inks`` (no point showing cards the user
 * can't play). Search matches against a normalised
 * ``name + version + text`` haystack, debounced by 80 ms so typing
 * is fluid even with 2 900-card pools.
 *
 * Rendering strategy: render the first ``PAGE_SIZE`` matches, then
 * a "Load more" button that appends another page. Cheaper than a
 * virtualiser, plenty fast for our pool size; we'll switch to a
 * proper virtualiser if profiling ever says we need to.
 *
 * Adding a card is a single click on the row's ``+`` button. The
 * row reads from the deck store on every store update so the
 * current count and the "at cap" disabled state stay in sync
 * without DOM diffs.
 */

import { computeMaxCopies, type CardT } from "@bjorvack/lorcana-schemas";

import { cards as allCards } from "../data/cards";
import { addCard } from "../state/deck";
import { deckStore } from "../state/index";
import { debounce } from "../utils/debounce";

const TAG = "card-finder";
const PAGE_SIZE = 60;

/** Lower-case-once haystack so search() doesn't repeat the work. */
interface SearchableCard {
  readonly card: CardT;
  readonly haystack: string;
}

const HAYSTACK: readonly SearchableCard[] = allCards.map((c) => ({
  card: c,
  haystack: `${c.name} ${c.version ?? ""} ${c.text}`.toLowerCase(),
}));

const INK_VAR: Record<string, string> = {
  Amber: "var(--ink-amber)",
  Amethyst: "var(--ink-amethyst)",
  Emerald: "var(--ink-emerald)",
  Ruby: "var(--ink-ruby)",
  Sapphire: "var(--ink-sapphire)",
  Steel: "var(--ink-steel)",
};

export class CardFinder extends HTMLElement {
  #query = "";
  #pageCount = 1;
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = deckStore.subscribe(() => this.renderResults());
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
  }

  private setQuery = debounce((q: string) => {
    this.#query = q.toLowerCase().trim();
    this.#pageCount = 1;
    this.renderResults();
  }, 80);

  private matches(): readonly CardT[] {
    const { inks } = deckStore.get();
    const inkSet = new Set(inks);
    const q = this.#query;
    const out: CardT[] = [];
    for (const { card, haystack } of HAYSTACK) {
      if (!card.inks.every((i) => inkSet.has(i))) continue;
      if (q && !haystack.includes(q)) continue;
      out.push(card);
    }
    // Stable, useful order: cost ascending, then name. Same shape as
    // the deck list so the eye doesn't have to recalibrate.
    out.sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  private render(): void {
    this.innerHTML = `
      <label class="card-search">
        <span class="visually-hidden">Search cards</span>
        <input
          type="search"
          placeholder="Search by name or text…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search cards"
        />
      </label>
      <div class="card-finder-results" aria-live="polite"></div>
      <div class="card-finder-footer"></div>
    `;
    const input = this.querySelector<HTMLInputElement>('input[type="search"]');
    input?.addEventListener("input", (e) => this.setQuery((e.target as HTMLInputElement).value));
    this.renderResults();
  }

  private renderResults(): void {
    const matches = this.matches();
    const results = this.querySelector<HTMLElement>(".card-finder-results");
    const footer = this.querySelector<HTMLElement>(".card-finder-footer");
    if (!results || !footer) return;

    const visible = matches.slice(0, this.#pageCount * PAGE_SIZE);
    if (visible.length === 0) {
      results.innerHTML = "";
      footer.innerHTML = "";
      results.append(buildEmpty(matches.length === 0));
      return;
    }

    const state = deckStore.get();
    const ul = document.createElement("ul");
    ul.className = "card-finder-list";
    ul.setAttribute("role", "list");
    for (const card of visible) {
      ul.append(buildRow(card, state.cards.get(card.id) ?? 0));
    }
    results.replaceChildren(ul);

    footer.innerHTML = "";
    const remaining = matches.length - visible.length;
    if (remaining > 0) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "secondary";
      more.textContent = `Load ${Math.min(remaining, PAGE_SIZE)} more (${remaining} hidden)`;
      more.addEventListener("click", () => {
        this.#pageCount++;
        this.renderResults();
      });
      footer.append(more);
    } else {
      const note = document.createElement("p");
      note.className = "card-finder-meta";
      note.textContent =
        visible.length === 1
          ? "1 card matches the current filters."
          : `${visible.length} cards match the current filters.`;
      footer.append(note);
    }
  }
}

function buildRow(card: CardT, count: number): HTMLElement {
  const li = document.createElement("li");
  li.className = "card-row";

  const cap = computeMaxCopies(card);
  const atCap = count >= cap;

  // Ink dots first so the eye finds the colour quickly even when
  // scanning fast.
  const inkBox = document.createElement("span");
  inkBox.className = "card-row-inks";
  inkBox.setAttribute("aria-hidden", "true");
  for (const ink of card.inks) {
    const dot = document.createElement("span");
    dot.className = "ink-dot";
    dot.style.background = INK_VAR[ink] ?? "var(--text-muted)";
    inkBox.append(dot);
  }

  const cost = document.createElement("span");
  cost.className = "card-row-cost";
  cost.setAttribute("aria-label", `${card.cost} ink`);
  cost.textContent = String(card.cost);

  const name = document.createElement("span");
  name.className = "card-row-name";
  name.textContent = card.version ? `${card.name} — ${card.version}` : card.name;

  const meta = document.createElement("span");
  meta.className = "card-row-meta";
  meta.textContent = card.types.join(" / ");

  const controls = document.createElement("span");
  controls.className = "card-row-controls";

  if (count > 0) {
    const countBadge = document.createElement("span");
    countBadge.className = "card-row-count";
    countBadge.textContent = `${count} / ${Number.isFinite(cap) ? cap : "∞"}`;
    controls.append(countBadge);
  }
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "primary card-row-add";
  addBtn.textContent = "+";
  addBtn.disabled = atCap;
  addBtn.setAttribute(
    "aria-label",
    atCap ? `${card.name} is already at ${cap} copies` : `Add ${card.name} to deck`,
  );
  addBtn.addEventListener("click", () => {
    deckStore.update((state) => addCard(state, card.id, 1).state);
  });
  controls.append(addBtn);

  li.append(inkBox, cost, name, meta, controls);
  return li;
}

function buildEmpty(noCardsAtAll: boolean): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const p = document.createElement("p");
  p.textContent = noCardsAtAll
    ? "No cards in the chosen inks. Try toggling an ink to broaden the pool."
    : "No matches. Try a different search.";
  empty.append(p);
  return empty;
}

if (!customElements.get(TAG)) customElements.define(TAG, CardFinder);
