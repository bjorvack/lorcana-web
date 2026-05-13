/**
 * <ink-selector> — chips for the six Lorcana inks.
 *
 * Today this only manages its own visual selection state (which
 * chips are pressed). Wiring it up to the deck store comes with
 * Phase 1's state management commit; emitting a CustomEvent lets
 * us swap the wiring in without touching the chip rendering.
 *
 * Selection rules per DESIGN.md:
 *   - 1 or 2 inks may be active at any time.
 *   - Clicking an unpressed chip when 2 are already pressed
 *     replaces the *last* one (FIFO over the pressed set).
 *   - Clicking a pressed chip un-presses it; selection collapses
 *     to whatever's still pressed (down to a single ink).
 *   - At least one ink must always be pressed; clicking the last
 *     pressed chip is a no-op.
 */

import { InkValues, type InkT } from "@bjorvack/lorcana-schemas";

const TAG = "ink-selector";

const INK_VAR: Record<InkT, string> = {
  Amber: "var(--ink-amber)",
  Amethyst: "var(--ink-amethyst)",
  Emerald: "var(--ink-emerald)",
  Ruby: "var(--ink-ruby)",
  Sapphire: "var(--ink-sapphire)",
  Steel: "var(--ink-steel)",
};

export class InkSelector extends HTMLElement {
  /** Inks currently pressed. FIFO so we know which one to drop. */
  #selected: InkT[] = ["Amber", "Steel"];

  connectedCallback(): void {
    this.render();
  }

  get selected(): readonly InkT[] {
    return this.#selected;
  }

  set selected(value: readonly InkT[]) {
    if (value.length < 1 || value.length > 2) {
      throw new Error(`ink-selector: selected must hold 1 or 2 inks, got ${value.length}`);
    }
    this.#selected = [...value];
    this.render();
  }

  private toggle(ink: InkT): void {
    const idx = this.#selected.indexOf(ink);
    if (idx >= 0) {
      // Don't allow dropping to zero — deck always has at least one ink.
      if (this.#selected.length === 1) return;
      this.#selected.splice(idx, 1);
    } else if (this.#selected.length < 2) {
      this.#selected.push(ink);
    } else {
      // Already at the 2-ink cap: drop the oldest, add the new one.
      this.#selected.shift();
      this.#selected.push(ink);
    }
    this.render();
    this.dispatchEvent(
      new CustomEvent<{ inks: InkT[] }>("inks-changed", {
        detail: { inks: [...this.#selected] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private render(): void {
    this.innerHTML = "";

    const label = document.createElement("span");
    label.className = "ink-label";
    label.textContent = "Inks:";
    this.append(label);

    for (const ink of InkValues) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ink-chip";
      chip.style.setProperty("--ink-color", INK_VAR[ink]);
      const pressed = this.#selected.includes(ink);
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      chip.setAttribute("aria-label", `Ink: ${ink}`);

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");
      chip.append(dot, document.createTextNode(ink));

      chip.addEventListener("click", () => this.toggle(ink));
      this.append(chip);
    }
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, InkSelector);
