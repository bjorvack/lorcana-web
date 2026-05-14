/**
 * <card-finder> — searchable, ink-constrained list of *logical* cards.
 *
 * Each row collapses every printing of a ``(name, version)`` pair into
 * a single entry. Where a card has more than one printing (~20 % of
 * the pool), the row carries a printing selector so the user can
 * choose which artwork ends up in the deck. The ``+`` button adds the
 * currently-selected printing id.
 *
 * Performance: the per-render search filters all ~2 300 logical
 * cards against a lowercased name+version+text haystack. Debounce on
 * the input keeps input latency low; pagination keeps DOM churn low.
 * Card images are ``loading="lazy"`` so a long visible list only
 * downloads what's actually on screen.
 */

import { computeMaxCopies, type CardT, type LegalityStatus } from "@bjorvack/lorcana-schemas";

import { cardLegality } from "../data/legality";
import { type LogicalCard, logicalCards } from "../data/logical";
import { addCard } from "../state/deck";
import { deckStore } from "../state/index";
import { bindImageFallback } from "../utils/card-image";
import { debounce } from "../utils/debounce";
import { bindPreviewTrigger } from "./card-preview";

const TAG = "card-finder";
const PAGE_SIZE = 60;

interface SearchableLogical {
  readonly logical: LogicalCard;
  readonly haystack: string;
}

const HAYSTACK: readonly SearchableLogical[] = logicalCards.map((lc) => ({
  logical: lc,
  haystack: `${lc.name} ${lc.version} ${lc.canonical.text}`.toLowerCase(),
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
  #selectedPrintingId = new Map<string, string>(); // logicalId -> printing id
  #showIllegal = false;
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

  private filterMatches(): readonly LogicalCard[] {
    const { inks, format } = deckStore.get();
    const inkSet = new Set(inks);
    const q = this.#query;
    const out: LogicalCard[] = [];
    for (const { logical, haystack } of HAYSTACK) {
      // A logical card is in-ink iff its (consistent) ink set is a
      // subset of the deck inks. We use the canonical printing's inks
      // because variants of the same logical card never differ here.
      if (!logical.canonical.inks.every((i) => inkSet.has(i))) continue;
      if (q && !haystack.includes(q)) continue;
      // Hide cards that aren't legal in the active format unless the
      // user explicitly toggled the override.
      if (!this.#showIllegal && cardLegality(logical.canonical, format) !== "legal") {
        continue;
      }
      out.push(logical);
    }
    out.sort((a, b) => {
      if (a.canonical.cost !== b.canonical.cost) return a.canonical.cost - b.canonical.cost;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  private printingForLogical(lc: LogicalCard): CardT {
    const selected = this.#selectedPrintingId.get(lc.logicalId);
    if (!selected) return lc.canonical;
    return lc.printings.find((p) => p.id === selected) ?? lc.canonical;
  }

  private countAcrossPrintings(lc: LogicalCard, state = deckStore.get()): number {
    let total = 0;
    for (const p of lc.printings) total += state.cards.get(p.id) ?? 0;
    return total;
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
      <label class="card-finder-toggle">
        <input type="checkbox" data-role="show-illegal" />
        <span>Show illegal cards</span>
      </label>
      <div class="card-finder-results" aria-live="polite"></div>
      <div class="card-finder-footer"></div>
    `;
    const input = this.querySelector<HTMLInputElement>('input[type="search"]');
    input?.addEventListener("input", (e) => this.setQuery((e.target as HTMLInputElement).value));
    const toggle = this.querySelector<HTMLInputElement>('[data-role="show-illegal"]');
    if (toggle) {
      toggle.checked = this.#showIllegal;
      toggle.addEventListener("change", () => {
        this.#showIllegal = toggle.checked;
        this.#pageCount = 1;
        this.renderResults();
      });
    }
    this.renderResults();
  }

  private renderResults(): void {
    const matches = this.filterMatches();
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

    const ul = document.createElement("ul");
    ul.className = "card-finder-list";
    ul.setAttribute("role", "list");
    for (const lc of visible) ul.append(this.buildRow(lc));
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

  private buildRow(lc: LogicalCard): HTMLElement {
    const li = document.createElement("li");
    li.className = "card-row";

    const printing = this.printingForLogical(lc);
    const card = lc.canonical; // shared gameplay-relevant fields
    const count = this.countAcrossPrintings(lc);
    const cap = computeMaxCopies(card);
    const atCap = count >= cap;

    // Image thumbnail. lazy-loading + a sized container so a slow
    // network doesn't cause layout shift as rows fill in.
    const thumbWrap = document.createElement("span");
    thumbWrap.className = "card-row-thumb";
    const img = document.createElement("img");
    img.src = printing.imageUrl;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = `${card.name}${card.version ? ` — ${card.version}` : ""}`;
    img.dataset.printing = printing.id;
    bindImageFallback(img, img.alt, printing.id);
    thumbWrap.append(img);

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

    const nameBox = document.createElement("span");
    nameBox.className = "card-row-namebox";
    const nameLine = document.createElement("span");
    nameLine.className = "card-row-nameline";
    const status = cardLegality(card, deckStore.get().format);
    nameLine.append(buildLegalityDot(status));
    const name = document.createElement("span");
    name.className = "card-row-name";
    name.textContent = card.name;
    nameLine.append(name);
    nameBox.append(nameLine);
    if (card.version) {
      // Version on its own row so long "Name — Version" pairs don't
      // get ellipsised on narrow viewports.
      const version = document.createElement("span");
      version.className = "card-row-version";
      version.textContent = card.version;
      nameBox.append(version);
    }

    const meta = document.createElement("span");
    meta.className = "card-row-meta";
    meta.textContent = card.types.join(" / ");
    nameBox.append(meta);

    // Printing picker: visible iff the logical card has > 1 printing.
    if (lc.printings.length > 1) {
      const select = document.createElement("select");
      select.className = "card-row-printing";
      select.setAttribute("aria-label", `Choose a printing of ${card.name}`);
      for (const p of lc.printings) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.setCode}-${String(p.cardNumber).padStart(3, "0")}`;
        if (p.id === printing.id) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener("change", () => {
        this.#selectedPrintingId.set(lc.logicalId, select.value);
        this.renderResults();
      });
      nameBox.append(select);
    }

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
      deckStore.update((state) => addCard(state, printing.id, 1).state);
    });
    controls.append(addBtn);

    li.append(thumbWrap, inkBox, cost, nameBox, controls);
    bindPreviewTrigger(li, printing);
    return li;
  }
}

const LEGALITY_LABEL: Record<LegalityStatus, string> = {
  legal: "Legal in this format",
  banned: "Banned in this format",
  rotated_out: "Rotated out of this format",
  not_yet_released: "Not yet released",
};

export function buildLegalityDot(status: LegalityStatus): HTMLElement {
  const dot = document.createElement("span");
  dot.className = `legality-dot legality-dot-${status.replace(/_/g, "-")}`;
  dot.setAttribute("aria-label", LEGALITY_LABEL[status]);
  dot.title = LEGALITY_LABEL[status];
  return dot;
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
