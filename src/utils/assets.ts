/**
 * Resolve a path relative to the deploy root.
 *
 * Vite's ``base: "./"`` makes the deploy work from any subpath
 * (e.g. ``/lorcana-web/`` on GitHub Pages). For files we drop in
 * ``public/``, the same prefix matters at runtime — hardcoding
 * ``/assets/…`` would 404 on a non-root deploy. ``import.meta.env``
 * gives us the right base.
 */

export function resolveAssetPath(rel: string): string {
  const base = import.meta.env.BASE_URL ?? "./";
  return base.endsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
}
