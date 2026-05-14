/**
 * <card-preview> — singleton overlay that shows the full card art.
 *
 * Click-to-open, click-outside / Escape / close-button to dismiss.
 * Same behaviour on desktop and mobile so there's only one mental
 * model to keep in your head.
 *
 * The component itself is mounted once at the end of ``<body>``.
 * Other components don't talk to it directly; they call
 * :func:`bindPreviewTrigger` on each row to wire up the open click.
 */

import type { CardT } from "@bjorvack/lorcana-schemas";

const TAG = "card-preview";

export class CardPreview extends HTMLElement {
  #card: CardT | null = null;

  connectedCallback(): void {
    this.render();
    document.addEventListener("keydown", this.handleKeydown);
    this.addEventListener("click", this.handleSelfClick);
  }

  disconnectedCallback(): void {
    document.removeEventListener("keydown", this.handleKeydown);
    this.removeEventListener("click", this.handleSelfClick);
  }

  show(card: CardT): void {
    this.#card = card;
    this.renderCard();
    this.setAttribute("data-visible", "true");
  }

  hide(): void {
    this.removeAttribute("data-visible");
    this.#card = null;
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.#card) this.hide();
  };

  private handleSelfClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    // A click on the backdrop (the host element itself) closes; clicks
    // on the close button close. Clicks inside the box are ignored.
    if (target === this) this.hide();
    if (target.closest('[data-role="preview-close"]')) this.hide();
  };

  private renderCard(): void {
    const card = this.#card;
    const box = this.querySelector(".card-preview-box");
    if (!box || !card) return;
    // Optional rich fields exposed in schemas 0.6.0. They're nullable
    // on older fixtures, so guard each one independently rather than
    // build a single conditional that disappears if any one is missing.
    const c = card as CardT & {
      rarity?: string | null;
      setName?: string | null;
      collectorNumber?: string | null;
      illustrators?: readonly string[];
      releasedAt?: string | null;
      tcgplayerId?: number | null;
    };
    const collector = c.collectorNumber ?? null;
    const setLine = [c.setName ?? null, collector ? `#${collector}` : null]
      .filter((x): x is string => Boolean(x))
      .join(" · ");
    const illustrators = (c.illustrators ?? []).filter(Boolean).join(", ");
    const buyHref = c.tcgplayerId ? `https://www.tcgplayer.com/product/${c.tcgplayerId}` : null;

    box.innerHTML = `
      <img
        class="card-preview-img"
        src="${card.imageUrl}"
        alt="${escapeHtml(`${card.name}${card.version ? ` — ${card.version}` : ""}`)}"
      />
      <div class="card-preview-body">
        <h3>${escapeHtml(card.name)}${card.version ? ` <span class="card-preview-version">${escapeHtml(card.version)}</span>` : ""}</h3>
        <p class="card-preview-line">
          <strong>${card.cost}</strong> ink ·
          ${card.inks.join(" / ")} ·
          ${card.types.join(" / ")}
          ${c.rarity ? ` · <span class="card-preview-rarity">${escapeHtml(c.rarity)}</span>` : ""}
        </p>
        ${setLine ? `<p class="card-preview-set">${escapeHtml(setLine)}</p>` : ""}
        ${card.text ? `<p class="card-preview-text">${escapeHtml(card.text)}</p>` : ""}
        ${card.flavor ? `<p class="card-preview-flavor">${escapeHtml(card.flavor)}</p>` : ""}
        ${illustrators ? `<p class="card-preview-illustrator">Art by ${escapeHtml(illustrators)}</p>` : ""}
        <div class="card-preview-actions">
          ${buyHref ? `<a class="secondary card-preview-buy" href="${buyHref}" target="_blank" rel="noopener">View on TCGPlayer</a>` : ""}
          <button class="ghost" data-role="preview-close" aria-label="Close preview">Close</button>
        </div>
      </div>
    `;
  }

  private render(): void {
    this.innerHTML = `<div class="card-preview-box" role="dialog" aria-modal="true"></div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
}

let _singleton: CardPreview | null = null;

function getPreview(): CardPreview {
  if (_singleton && _singleton.isConnected) return _singleton;
  const el = document.createElement(TAG) as CardPreview;
  document.body.append(el);
  _singleton = el;
  return el;
}

/**
 * Wire a row element so clicking it (outside its own buttons / selects)
 * opens a preview of ``card``. Idempotent on the same row.
 */
export function bindPreviewTrigger(row: HTMLElement, card: CardT): void {
  if (row.dataset.previewBound === "1") return;
  row.dataset.previewBound = "1";

  row.addEventListener("click", (event) => {
    // Don't intercept clicks on the row's own controls (+/-/lock/select).
    const target = event.target as HTMLElement;
    if (target.closest("button, select, input, a")) return;
    getPreview().show(card);
  });
}

if (!customElements.get(TAG)) customElements.define(TAG, CardPreview);
