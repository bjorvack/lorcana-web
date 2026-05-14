/**
 * Card-image helpers.
 *
 * Image hosts (Lorcast et al) occasionally 404 individual prints —
 * usually shortly after a new set drops and the CDN hasn't caught up.
 * Card art is non-critical (DESIGN Q6); the deckbuilder falls back
 * in two steps:
 *
 *   1. The build bakes a low-res WebP thumbnail of every card under
 *      ``/assets/thumbs/<id>.webp``. ``bindImageFallback`` swaps to
 *      that local path on the first error.
 *   2. If the local thumb also fails (e.g. ``pnpm dev`` skipped the
 *      bake step), we replace the <img> with a typed first-letter
 *      glyph so the row never shows a broken-image icon.
 */

import { resolveAssetPath } from "./assets";

/**
 * Attach an ``error`` handler that replaces a broken <img> with the
 * baked thumb, or — if that also fails — a typed fallback glyph.
 * Idempotent: re-attaching the handler doesn't stack listeners.
 */
export function bindImageFallback(img: HTMLImageElement, alt: string, cardId?: string): void {
  if (img.dataset.fallbackBound === "1") return;
  img.dataset.fallbackBound = "1";
  let stage: "thumb" | "glyph" = cardId ? "thumb" : "glyph";
  img.addEventListener("error", () => {
    if (stage === "thumb" && cardId) {
      stage = "glyph";
      img.src = resolveAssetPath(`assets/thumbs/${cardId}.webp`);
      return;
    }
    const fallback = document.createElement("span");
    fallback.className = "card-image-fallback";
    fallback.setAttribute("aria-label", alt);
    fallback.title = alt;
    fallback.textContent = alt.charAt(0).toUpperCase() || "?";
    img.replaceWith(fallback);
  });
}
