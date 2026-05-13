/**
 * Browser shim for ``node:crypto``.
 *
 * ``@bjorvack/lorcana-schemas`` imports ``createHash`` from ``crypto``
 * at the top of its ESM entry to power ``hashCardSet``. The web app
 * never calls that function — we trust the scraper's pre-computed
 * ``cardSetVersion`` — but the import has to resolve to *something*
 * for Rollup to finish bundling.
 *
 * The shim throws if anyone actually invokes ``createHash`` in the
 * browser, which guarantees we'll find out fast if the bundle ever
 * accidentally pulls in code that needs it. Use the Web Crypto
 * ``subtle.digest`` API instead.
 *
 * Once ``lorcana-schemas`` gates its crypto import behind a runtime
 * check or moves ``hashCardSet`` to a separate Node-only entry point,
 * this shim can go.
 */

export function createHash(_algorithm: string): never {
  throw new Error(
    "node:crypto.createHash is not available in the browser bundle. " +
      "Use Web Crypto (window.crypto.subtle.digest) for hashing on the client.",
  );
}
