/**
 * Card-image helpers.
 *
 * Image hosts (Lorcast et al) occasionally 404 individual prints —
 * usually shortly after a new set drops and the CDN hasn't caught up.
 * The deckbuilder treats card art as non-critical (DESIGN.md), so we
 * hide the broken <img> and swap in a typed fallback glyph rather
 * than showing a broken-image icon or surfacing a banner.
 */

/**
 * Attach an ``error`` handler that replaces a broken <img> with a
 * fallback glyph. Idempotent: re-attaching the handler doesn't
 * stack listeners.
 */
export function bindImageFallback(img: HTMLImageElement, alt: string): void {
  if (img.dataset.fallbackBound === "1") return;
  img.dataset.fallbackBound = "1";
  img.addEventListener("error", () => {
    const fallback = document.createElement("span");
    fallback.className = "card-image-fallback";
    fallback.setAttribute("aria-label", alt);
    fallback.title = alt;
    fallback.textContent = alt.charAt(0).toUpperCase() || "?";
    img.replaceWith(fallback);
  });
}
