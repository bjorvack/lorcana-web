/**
 * Vite plugin: drop the ~26 MB ``ort-wasm-*.wasm`` files from the
 * production build.
 *
 * The inference worker overrides ``ort.env.wasm.wasmPaths`` to the
 * jsDelivr-hosted ``onnxruntime-web`` package at runtime, so the
 * Vite-emitted copies under ``dist/assets/`` are never fetched in
 * production. Vite still copies them through because the ORT runtime
 * imports the wasm via a dynamic ``new URL(..., import.meta.url)``
 * pattern that the bundler can't statically prove is dead.
 *
 * The simplest fix that doesn't require rewriting ORT's imports is
 * to delete the wasm files after the build's normal output phase
 * finishes. ``closeBundle`` is the right hook: ``writeBundle`` would
 * race with Vite's own asset emission. We also drop the matching
 * ``.mjs`` JS shims that load those wasm files — they're tiny but
 * dead code without their wasm sibling.
 *
 * If someone wants the WASM hosted from the same origin (no
 * jsDelivr dependency), comment this plugin out and update
 * ``inference.worker.ts`` to drop the ``wasmPaths`` override.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";

/** Pattern matching the ORT-emitted artefacts we want gone. */
const STRIP_PATTERNS: readonly RegExp[] = [
  /^ort-wasm-.*\.wasm$/,
  /^ort-wasm-.*\.mjs$/,
  /^ort\.bundle\.min\.mjs$/,
];

export function stripOrtWasm(opts: { dir?: string } = {}): Plugin {
  const targetDir = opts.dir ?? "dist/assets";
  return {
    name: "lorcana:strip-ort-wasm",
    apply: "build",
    closeBundle: {
      // ``sequential: true`` so we run after every other plugin's
      // ``closeBundle`` (including Vite's own asset emission).
      sequential: true,
      handler() {
        const dir = resolve(process.cwd(), targetDir);
        if (!existsSync(dir)) return;
        const entries = readdirSync(dir);
        let bytes = 0;
        let removed = 0;
        for (const name of entries) {
          if (!STRIP_PATTERNS.some((re) => re.test(name))) continue;
          const path = resolve(dir, name);
          bytes += statSync(path).size;
          rmSync(path);
          removed++;
        }
        if (removed > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[strip-ort-wasm] removed ${removed} file(s), ` +
              `${(bytes / 1024 / 1024).toFixed(1)} MB freed`,
          );
        }
      },
    },
  };
}
