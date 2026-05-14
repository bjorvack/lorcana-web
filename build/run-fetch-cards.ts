/**
 * Standalone entry point for the fetch-cards plugin so CI (and
 * humans, on a fresh checkout) can materialise ``src/data/cards.json``
 * + ``src/data/cards.meta.ts`` *before* running typecheck / lint /
 * tests.
 *
 * The plugin is normally invoked by Vite during ``pnpm build`` /
 * ``pnpm dev``, but those run after typecheck in CI by design (we
 * don't want to spend GitHub minutes bundling a broken codebase).
 * Without this shim, ``tsc --noEmit`` fails on the import of
 * ``./cards.json`` because the file hasn't been generated yet.
 *
 *   pnpm prefetch:cards
 */

import { fetchCards } from "./fetch-cards";

const plugin = fetchCards();

// The plugin object's `buildStart` hook expects to be bound to Vite's
// rollup-style plugin context, which provides `this.info`. We
// synthesise the minimum surface area the plugin actually uses so
// this script can run outside Vite without dragging in @types/rollup.
const fakeCtx = {
  info(msg: string): void {
    process.stdout.write(`${msg}\n`);
  },
};

const hook = plugin.buildStart;
if (typeof hook !== "function") {
  throw new Error("fetchCards plugin is missing buildStart");
}

await (hook as unknown as (this: typeof fakeCtx, opts: unknown) => Promise<void>).call(fakeCtx, {
  plugins: [],
});
