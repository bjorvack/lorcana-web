/**
 * Vite plugin: download and emit ``cards-vN`` at build time.
 *
 * The deployed web app never fetches card data at runtime; the whole
 * ``CardSet`` is baked into the bundle as ESM. Doing the download in
 * a plugin (instead of a separate script) gives us a single
 * ``pnpm build`` command and lets us cache between runs.
 *
 * Outputs:
 *   src/data/cards.json       — the verbatim ``cards-vN`` payload, used
 *                                as the source of truth at runtime.
 *   src/data/cards.meta.ts    — pinned tag + cardSetVersion the web
 *                                app's manifest check compares
 *                                against.
 *
 * If the file is already present and matches the pinned tag from
 * ``src/version.ts``, the plugin is a no-op (idempotent dev loop).
 *
 * Failure modes:
 *   - GitHub API returns non-2xx -> build fails with the upstream message.
 *   - Asset sha256 disagrees with the published ``cards.json.sha256``
 *     sidecar -> build fails.
 *   - ``CardSet.parse`` rejects the payload -> build fails with the
 *     full zod issue list.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CardSet, type CardSetT } from "@bjorvack/lorcana-schemas";
import type { Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCRAPER_REPO = "bjorvack/lorcana-scraper";

interface FetchCardsOptions {
  /** Override the tag baked into ``src/version.ts``. Useful for CI dry-runs. */
  tag?: string;
  /** Where the downloaded artefacts land. Defaults to ``src/data/``. */
  outDir?: string;
}

export function fetchCards(opts: FetchCardsOptions = {}): Plugin {
  return {
    name: "lorcana:fetch-cards",
    // Run during config/dev startup *and* the build, but only once
    // per invocation — Vite calls `buildStart` for both modes.
    async buildStart() {
      const tag = opts.tag ?? (await readPinnedTag());
      const outDir = opts.outDir ?? resolve(REPO_ROOT, "src", "data");
      const cardsJsonPath = resolve(outDir, "cards.json");
      const cardsMetaPath = resolve(outDir, "cards.meta.ts");
      mkdirSync(outDir, { recursive: true });

      if (await alreadyFresh(cardsMetaPath, tag)) {
        this.info(`[fetch-cards] using cached ${cardsJsonPath} for ${tag}`);
        return;
      }

      const { cards, sha256 } = await downloadAndVerify(tag);
      writeFileSync(cardsJsonPath, JSON.stringify(cards) + "\n", "utf8");
      writeFileSync(
        cardsMetaPath,
        renderMeta({
          tag,
          cardSetVersion: cards.cardSetVersion,
          sha256,
          count: cards.cards.length,
        }),
        "utf8",
      );
      this.info(
        `[fetch-cards] wrote ${cardsJsonPath} (${cards.cards.length} cards, ${tag}, ${cards.cardSetVersion})`,
      );
    },
  };
}

async function readPinnedTag(): Promise<string> {
  // `src/version.ts` is hand-edited TypeScript with a single
  // `CARDS_RELEASE_TAG = "..."` line. We avoid `ts-node` here by
  // string-matching; the format is stable and the plugin runs at
  // build time only.
  const versionPath = resolve(REPO_ROOT, "src", "version.ts");
  const source = readFileSync(versionPath, "utf8");
  const m = source.match(/CARDS_RELEASE_TAG\s*=\s*"([^"]+)"/);
  if (!m?.[1]) {
    throw new Error(`Could not parse CARDS_RELEASE_TAG from ${versionPath}`);
  }
  return m[1];
}

async function alreadyFresh(cardsMetaPath: string, tag: string): Promise<boolean> {
  if (!existsSync(cardsMetaPath)) return false;
  const stat = statSync(cardsMetaPath);
  if (stat.size === 0) return false;
  const content = readFileSync(cardsMetaPath, "utf8");
  return content.includes(`"${tag}"`);
}

async function downloadAndVerify(tag: string): Promise<{ cards: CardSetT; sha256: string }> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.NODE_AUTH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  // 1. Resolve the release + its assets.
  const releaseUrl = `https://api.github.com/repos/${SCRAPER_REPO}/releases/tags/${tag}`;
  const releaseRes = await fetch(releaseUrl, { headers });
  if (!releaseRes.ok) {
    throw new Error(`${releaseUrl}: HTTP ${releaseRes.status} ${releaseRes.statusText}`);
  }
  const release = (await releaseRes.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };
  const cardsAsset = release.assets.find((a) => a.name === "cards.json");
  const shaAsset = release.assets.find((a) => a.name === "cards.json.sha256");
  if (!cardsAsset || !shaAsset) {
    const present = release.assets.map((a) => a.name).join(", ");
    throw new Error(`${tag}: missing cards.json or cards.json.sha256 (have: ${present})`);
  }

  // 2. Fetch the sha256 sidecar, then the payload, then verify.
  const expectedSha = (await (await fetch(shaAsset.browser_download_url, { headers })).text())
    .trim()
    .split(/\s+/)[0]!;
  const payload = await (await fetch(cardsAsset.browser_download_url, { headers })).text();
  const gotSha = createHash("sha256").update(payload, "utf8").digest("hex");
  if (gotSha !== expectedSha) {
    throw new Error(
      `cards.json sha256 mismatch for ${tag}: got ${gotSha}, expected ${expectedSha}`,
    );
  }

  // 3. Schema-validate. Throwing a zod ZodError here surfaces the
  //    exact rejected fields in the build output.
  const parsed = CardSet.parse(JSON.parse(payload));
  return { cards: parsed, sha256: gotSha };
}

function renderMeta(args: {
  tag: string;
  cardSetVersion: string;
  sha256: string;
  count: number;
}): string {
  return [
    "/**",
    " * AUTO-GENERATED by build/fetch-cards.ts at build time.",
    " * Do not edit by hand; bump CARDS_RELEASE_TAG in src/version.ts instead.",
    " */",
    "",
    `export const CARDS_RELEASE_TAG = "${args.tag}";`,
    `export const CARD_SET_VERSION = "${args.cardSetVersion}";`,
    `export const CARDS_JSON_SHA256 = "sha256:${args.sha256}";`,
    `export const CARD_COUNT = ${args.count};`,
    "",
  ].join("\n");
}
