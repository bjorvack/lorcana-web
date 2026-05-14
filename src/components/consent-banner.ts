/**
 * <consent-banner> — GDPR-compliant analytics consent prompt.
 *
 * Bottom-of-screen, non-blocking. The deck builder is fully usable
 * while the banner is visible (no overlay, no scroll lock). Hidden
 * unless the consent store says ``unset``; clicking Accept / Decline
 * persists the choice and dismisses the banner.
 *
 * Honest wording per DESIGN Q8: tells the user what GA4 is for in
 * plain language, both buttons are equally weighted, no dark
 * patterns. Decline never loads GA in this session or any future
 * one until the user re-opens consent via the About modal.
 */

import { consentStore, setConsent } from "../state/analytics";

const TAG = "consent-banner";

export class ConsentBanner extends HTMLElement {
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = consentStore.subscribe(() => this.render());
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
  }

  private render(): void {
    const { choice } = consentStore.get();
    if (choice !== "unset") {
      this.hidden = true;
      this.innerHTML = "";
      return;
    }
    this.hidden = false;
    this.className = "consent-banner";
    this.setAttribute("role", "region");
    this.setAttribute("aria-label", "Analytics consent");
    this.innerHTML = `
      <div class="consent-banner-body">
        <p>
          We use <strong>Google Analytics</strong> to learn which features get used.
          No tracking happens until you click Accept; Decline disables analytics entirely.
        </p>
        <div class="consent-banner-buttons">
          <button class="secondary" type="button" data-role="consent-decline">Decline</button>
          <button class="primary" type="button" data-role="consent-accept">Accept</button>
        </div>
      </div>
    `;
    this.querySelector<HTMLButtonElement>('[data-role="consent-accept"]')?.addEventListener(
      "click",
      () => setConsent("accepted"),
    );
    this.querySelector<HTMLButtonElement>('[data-role="consent-decline"]')?.addEventListener(
      "click",
      () => setConsent("declined"),
    );
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, ConsentBanner);
