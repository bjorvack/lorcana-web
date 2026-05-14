/**
 * <realism-pill> — calibrated evaluator score, surfaced next to the
 * deck heading after a successful Generate.
 *
 * Subscribes to ``generationStore`` and renders a small pill with the
 * score formatted as a percentage. Hidden when no recent generation
 * is available, so an empty deck or an edited-since-Generate state
 * doesn't clutter the panel.
 */

import { generationStore } from "../state/generation";

const TAG = "realism-pill";

export class RealismPill extends HTMLElement {
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = generationStore.subscribe(() => this.render());
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
  }

  private render(): void {
    const r = generationStore.get().lastRealism;
    if (r === null) {
      this.hidden = true;
      this.innerHTML = "";
      return;
    }
    this.hidden = false;
    const pct = Math.round(r * 100);
    const kind = pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";
    this.className = `realism-pill realism-pill-${kind}`;
    this.title = "How plausible the evaluator thinks this deck is. Updates after every Generate.";
    this.innerHTML = `
      <span class="realism-pill-label">Realism</span>
      <span class="realism-pill-value">${pct}%</span>
    `;
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, RealismPill);
