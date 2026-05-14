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

import {
  Banlist,
  CardSet,
  Rotation,
  type BanlistT,
  type CardSetT,
  type RotationT,
} from "@bjorvack/lorcana-schemas";
import type { Plugin } from "vite";

// Empty defaults shipped when a cards-vN release predates the
// legality assets. The format-aware UI then degrades gracefully:
// every card is "legal" and no bans/rotations apply.
function emptyBanlist(): BanlistT {
  return {
    generatedAt: new Date(0).toISOString(),
    sourceUrl: "about:blank",
    schemaVersion: "0.5.0",
    formats: { core_constructed: [], infinity_constructed: [] },
  };
}
function emptyRotation(cards: CardSetT): RotationT {
  // The schema requires at least one block, and ``coreLegalSetCodes``
  // returns *only* setCodes belonging to a non-rotated block. To keep
  // every real card Core-legal until the scraper ships a real rotation,
  // we synthesise a single far-future block that covers every setCode
  // present in the just-downloaded cards.json.
  const setCodes = [...new Set(cards.cards.map((c) => c.setCode))].sort();
  return {
    generatedAt: new Date(0).toISOString(),
    sourceUrl: "about:blank",
    schemaVersion: "0.5.0",
    blocks: [
      {
        name: "placeholder",
        setCodes: setCodes.length > 0 ? setCodes : ["999"],
        releaseDate: "1970-01-01",
        rotationDate: "9999-12-31",
      },
    ],
    coreConstructedCutoffMonths: 24,
  };
}

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
      const legalityTag = (await readLegalityTag()) ?? tag;
      const outDir = opts.outDir ?? resolve(REPO_ROOT, "src", "data");
      const cardsJsonPath = resolve(outDir, "cards.json");
      const cardsMetaPath = resolve(outDir, "cards.meta.ts");
      mkdirSync(outDir, { recursive: true });

      if (await alreadyFresh(cardsMetaPath, tag, legalityTag)) {
        this.info(`[fetch-cards] using cached ${cardsJsonPath} for ${tag}`);
        return;
      }

      const { cards, sha256, banlist, rotation } = await downloadAndVerify(tag, legalityTag);
      writeFileSync(cardsJsonPath, JSON.stringify(cards) + "\n", "utf8");
      writeFileSync(resolve(outDir, "banlist.json"), JSON.stringify(banlist) + "\n", "utf8");
      writeFileSync(resolve(outDir, "rotation.json"), JSON.stringify(rotation) + "\n", "utf8");
      writeFileSync(
        cardsMetaPath,
        renderMeta({
          tag,
          legalityTag,
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

async function readLegalityTag(): Promise<string | null> {
  const versionPath = resolve(REPO_ROOT, "src", "version.ts");
  const source = readFileSync(versionPath, "utf8");
  const nullMatch = source.match(/export\s+const\s+LEGALITY_RELEASE_TAG[^=\n]*=\s*null/);
  if (nullMatch) return null;
  const valueMatch = source.match(/export\s+const\s+LEGALITY_RELEASE_TAG[^=\n]*=\s*"([^"]+)"/);
  return valueMatch?.[1] ?? null;
}

async function alreadyFresh(
  cardsMetaPath: string,
  tag: string,
  legalityTag: string,
): Promise<boolean> {
  if (!existsSync(cardsMetaPath)) return false;
  const stat = statSync(cardsMetaPath);
  if (stat.size === 0) return false;
  const content = readFileSync(cardsMetaPath, "utf8");
  return content.includes(`"${tag}"`) && content.includes(`"${legalityTag}"`);
}

async function downloadAndVerify(
  tag: string,
  legalityTag: string,
): Promise<{ cards: CardSetT; sha256: string; banlist: BanlistT; rotation: RotationT }> {
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

  // 4. Optional legality assets (banlist.json + rotation.json). Older
  //    cards-vN releases predate these — fall back to empty defaults
  //    so the build still succeeds and the format-aware UI degrades
  //    to "everything legal". ``legalityTag`` lets us pull these from
  //    a different release than the one we pin cards to — useful when
  //    the matching ``model-vN`` was trained on an older ``cards-vN``
  //    that doesn't yet carry the legality data.
  const legalityAssets =
    legalityTag === tag ? release.assets : await fetchReleaseAssets(legalityTag, headers);
  const banlist = await downloadOptionalJson<BanlistT>(
    legalityAssets,
    "banlist.json",
    headers,
    (raw) => Banlist.parse(raw),
  );
  const rotation = await downloadOptionalJson<RotationT>(
    legalityAssets,
    "rotation.json",
    headers,
    (raw) => Rotation.parse(raw),
  );

  return {
    cards: parsed,
    sha256: gotSha,
    banlist: banlist ?? emptyBanlist(),
    rotation: rotation ?? emptyRotation(parsed),
  };
}

async function fetchReleaseAssets(
  tag: string,
  headers: Record<string, string>,
): Promise<{ name: string; browser_download_url: string }[]> {
  const url = `https://api.github.com/repos/${SCRAPER_REPO}/releases/tags/${tag}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status} ${res.statusText}`);
  }
  return ((await res.json()) as { assets: { name: string; browser_download_url: string }[] })
    .assets;
}

async function downloadOptionalJson<T>(
  assets: { name: string; browser_download_url: string }[],
  name: string,
  headers: Record<string, string>,
  parse: (raw: unknown) => T,
): Promise<T | null> {
  const asset = assets.find((a) => a.name === name);
  if (!asset) return null;
  const text = await (await fetch(asset.browser_download_url, { headers })).text();
  return parse(JSON.parse(text));
}

function renderMeta(args: {
  tag: string;
  legalityTag: string;
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
    `export const LEGALITY_RELEASE_TAG = "${args.legalityTag}";`,
    `export const CARD_SET_VERSION = "${args.cardSetVersion}";`,
    `export const CARDS_JSON_SHA256 = "sha256:${args.sha256}";`,
    `export const CARD_COUNT = ${args.count};`,
    "",
  ].join("\n");
}
