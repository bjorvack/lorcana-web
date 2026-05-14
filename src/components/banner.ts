/**
 * <app-banner> — dismissible inline message.
 *
 * Used for non-fatal feedback at the top of the workspace: URL-hash
 * load warnings ("couldn't decode the deck payload"), schema-bumps
 * the bundled cards-vN can't fully express, etc. Never blocking,
 * always dismissible.
 *
 * API:
 *   <app-banner> exposes ``show(message, kind?)`` and ``dismiss()``;
 *   ``kind`` is one of ``info | warning | error`` and drives the
 *   accent colour. Calling ``show`` while a previous banner is
 *   visible replaces the content rather than stacking — keeps the
 *   action bar density predictable.
 */

const TAG = "app-banner";

type BannerKind = "info" | "warning" | "error";

export class AppBanner extends HTMLElement {
  connectedCallback(): void {
    this.render(null, "info");
  }

  show(message: string, kind: BannerKind = "warning"): void {
    this.render(message, kind);
  }

  showMany(messages: readonly string[], kind: BannerKind = "warning"): void {
    if (messages.length === 0) {
      this.dismiss();
      return;
    }
    if (messages.length === 1) {
      this.render(messages[0]!, kind);
      return;
    }
    const html =
      `<ul class="banner-list">` +
      messages.map((m) => `<li>${escapeHtml(m)}</li>`).join("") +
      `</ul>`;
    this.render(html, kind, { isHtml: true });
  }

  dismiss(): void {
    this.render(null, "info");
  }

  private render(message: string | null, kind: BannerKind, opts: { isHtml?: boolean } = {}): void {
    if (message === null) {
      this.hidden = true;
      this.innerHTML = "";
      return;
    }
    this.hidden = false;
    this.className = `app-banner app-banner-${kind}`;
    this.setAttribute("role", kind === "error" ? "alert" : "status");
    this.innerHTML = `
      <span class="app-banner-body">${opts.isHtml ? message : escapeHtml(message)}</span>
      <button class="ghost" data-role="banner-dismiss" aria-label="Dismiss">×</button>
    `;
    this.querySelector<HTMLButtonElement>('[data-role="banner-dismiss"]')?.addEventListener(
      "click",
      () => this.dismiss(),
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (!customElements.get(TAG)) customElements.define(TAG, AppBanner);
