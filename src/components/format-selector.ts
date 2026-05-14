/**
 * <format-selector> — two-chip switch between Core and Infinity.
 *
 * Wired the same way as <ink-selector>: emits a CustomEvent that
 * <app-root> bridges into the deck store via the ``setFormat``
 * reducer. The selected value is mirrored in the URL hash by the
 * store subscription in <app-root>, so a shared link reproduces
 * the same legality state.
 */

import type { Format } from "../data/legality";

const TAG = "format-selector";

const FORMATS: ReadonlyArray<{ value: Format; label: string; hint: string }> = [
  {
    value: "core_constructed",
    label: "Core",
    hint: "Most recent two yearly blocks of sets; banlist applied.",
  },
  {
    value: "infinity_constructed",
    label: "Infinity",
    hint: "Every set ever printed; separate banlist applied.",
  },
];

export class FormatSelector extends HTMLElement {
  #selected: Format = "core_constructed";

  connectedCallback(): void {
    this.render();
  }

  get selected(): Format {
    return this.#selected;
  }

  set selected(value: Format) {
    this.#selected = value;
    this.render();
  }

  private choose(format: Format): void {
    if (this.#selected === format) return;
    this.#selected = format;
    this.render();
    this.dispatchEvent(
      new CustomEvent<{ format: Format }>("format-changed", {
        detail: { format },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private render(): void {
    this.innerHTML = "";

    const label = document.createElement("span");
    label.className = "ink-label";
    label.textContent = "Format:";
    this.append(label);

    for (const f of FORMATS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "format-chip";
      const pressed = f.value === this.#selected;
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      chip.setAttribute("aria-label", `Format: ${f.label}`);
      chip.title = f.hint;
      chip.textContent = f.label;
      chip.addEventListener("click", () => this.choose(f.value));
      this.append(chip);
    }
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, FormatSelector);
