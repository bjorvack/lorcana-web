/**
 * <app-root> — top-level shell.
 *
 * Renders the layout (header + action bar + two-column workspace)
 * and stitches together the major regions. The regions themselves
 * are largely placeholder for now; state wiring lands in the next
 * Phase 1 commit (state/store + state/deck).
 */

import { CARD_COUNT, CARDS_RELEASE_TAG } from "../data/cards";
import { VERSION } from "../version";
import "./ink-selector";

const TAG = "app-root";

export class AppRoot extends HTMLElement {
  connectedCallback(): void {
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
        <button class="ghost" disabled title="Coming in the next commit">Clear deck</button>
      </div>

      <div class="workspace">
        <section class="panel" aria-labelledby="deck-heading">
          <header>
            <h2 id="deck-heading">Deck</h2>
            <span class="count">0 / 60</span>
          </header>
          <div class="empty-state">
            <p>Pick your inks above, then add cards from the finder to start building.</p>
          </div>
        </section>

        <section class="panel" aria-labelledby="finder-heading">
          <header>
            <h2 id="finder-heading">Card finder</h2>
          </header>
          <div class="empty-state">
            <p>Search and filters land in the next commit.</p>
          </div>
        </section>
      </div>
    `;
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, AppRoot);
