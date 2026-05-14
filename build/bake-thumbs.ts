/**
 * Vite plugin: bake a low-res WebP thumbnail of every card into the
 * deploy bundle.
 *
 * Per DESIGN Q6, card art is non-critical but a wall of broken-image
 * icons would visually destroy the finder if Lorcast goes down. We
 * download the full image from Lorcast once at build time, downscale
 * to 80×112 WebP @ q40, and emit one file per card under
 * ``public/assets/thumbs/<id>.webp``. Runtime ``bindImageFallback``
 * swaps to the local thumb when the Lorcast <img> errors.
 *
 * Cache lives at ``node_modules/.cache/lorcana-thumbs/`` so subsequent
 * builds skip the slow Lorcast roundtrip for cards that haven't
 * changed.
 *
 * Failure mode: a single Lorcast 404 logs a warning and skips that
 * card (a few broken cards shouldn't fail the whole build). A total
 * failure rate above 5% does fail the build, on the theory that
 * Lorcast was probably down and the partial bundle isn't worth
 * shipping.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import type { Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const THUMB_WIDTH = 80;
const THUMB_HEIGHT = 112;
const QUALITY = 40;
/** Concurrent fetches; Lorcast handles small bursts fine, but we
 * don't want to hammer it. */
const CONCURRENCY = 8;
/** A run is allowed to lose this fraction of cards to errors before
 * we fail the build. */
const MAX_ERROR_RATIO = 0.05;

interface BakeThumbsOptions {
  /** When ``false``, the plugin is a no-op. Useful for ``pnpm dev``
   *  where the thumb fallback isn't worth a slow boot. */
  enabled?: boolean;
}

export function bakeThumbs(opts: BakeThumbsOptions = {}): Plugin {
  let ran = false;
  return {
    name: "lorcana:bake-thumbs",
    async buildStart() {
      if (ran) return;
      ran = true;
      if (opts.enabled === false) {
        this.info("[bake-thumbs] disabled by option");
        return;
      }

      const cardsPath = resolve(REPO_ROOT, "src", "data", "cards.json");
      if (!existsSync(cardsPath)) {
        // fetchCards plugin hasn't run yet — Vite ordering should
        // guarantee this can't happen, but bail loudly rather than
        // emit an empty thumb dir.
        throw new Error(
          `[bake-thumbs] expected ${cardsPath} to exist (fetchCards should run first)`,
        );
      }
      const raw = JSON.parse(readFileSync(cardsPath, "utf8")) as {
        cards: { id: string; imageUrl: string }[];
      };
      const cards = raw.cards;
      const cacheDir = resolve(REPO_ROOT, "node_modules", ".cache", "lorcana-thumbs");
      const outDir = resolve(REPO_ROOT, "public", "assets", "thumbs");
      mkdirSync(cacheDir, { recursive: true });
      mkdirSync(outDir, { recursive: true });

      let baked = 0;
      let cached = 0;
      let errored = 0;
      let totalBytes = 0;
      const errors: string[] = [];

      // Round-robin worker pool over the card list.
      const queue = [...cards];
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const card = queue.shift()!;
          try {
            const result = await bakeOne(card, cacheDir, outDir);
            if (result.fromCache) cached++;
            else baked++;
            totalBytes += result.bytes;
          } catch (e) {
            errored++;
            errors.push(`${card.id}: ${(e as Error).message}`);
          }
        }
      });
      await Promise.all(workers);

      const errRatio = cards.length > 0 ? errored / cards.length : 0;
      this.info(
        `[bake-thumbs] ${baked} baked, ${cached} cached, ${errored} errors (${(errRatio * 100).toFixed(1)}%). ` +
          `Total: ${(totalBytes / 1024).toFixed(0)} KB`,
      );
      if (errored > 0) {
        // Surface the first few failures so a flaky CDN doesn't go
        // unnoticed even if the run still passes.
        for (const e of errors.slice(0, 5)) this.warn(`[bake-thumbs] ${e}`);
      }
      if (errRatio > MAX_ERROR_RATIO) {
        throw new Error(
          `[bake-thumbs] error rate ${(errRatio * 100).toFixed(1)}% > ${MAX_ERROR_RATIO * 100}%; aborting`,
        );
      }
    },
  };
}

async function bakeOne(
  card: { id: string; imageUrl: string },
  cacheDir: string,
  outDir: string,
): Promise<{ fromCache: boolean; bytes: number }> {
  const key = createHash("sha256")
    .update(`${card.id}|${card.imageUrl}|${THUMB_WIDTH}x${THUMB_HEIGHT}q${QUALITY}`)
    .digest("hex");
  const cachePath = resolve(cacheDir, `${key}.webp`);
  const outPath = resolve(outDir, `${card.id}.webp`);
  if (existsSync(cachePath)) {
    const buf = readFileSync(cachePath);
    writeFileSync(outPath, buf);
    return { fromCache: true, bytes: statSync(cachePath).size };
  }
  const res = await fetch(card.imageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const inBuf = Buffer.from(await res.arrayBuffer());
  const outBuf = await sharp(inBuf)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: "cover" })
    .webp({ quality: QUALITY })
    .toBuffer();
  writeFileSync(cachePath, outBuf);
  writeFileSync(outPath, outBuf);
  return { fromCache: false, bytes: outBuf.byteLength };
}
