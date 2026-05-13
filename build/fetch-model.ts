/**
 * Vite plugin: at build start, download the pinned ``model-vN`` bundle
 * into ``public/model/`` and write a ``src/data/model.meta.ts`` so
 * runtime code can know the pinned tag, cardSetVersion, and per-asset
 * sha256s without a second network call.
 *
 * The deployed web app never fetches from GitHub Releases at runtime.
 * Files in ``public/`` are served from the Pages origin alongside the
 * rest of the bundle, so the only cross-origin fetch a deployed user
 * makes is for card art images.
 *
 * Failure modes the plugin guards against:
 *
 *   - Missing ``model-manifest.json`` in the release assets.
 *   - Any asset sha256 disagrees with the manifest.
 *   - The release's ``cardSetVersion`` doesn't match the one
 *     ``fetch-cards`` just wrote to ``src/data/cards.meta.ts``. This
 *     is the single guard that keeps the deployed bundle's vocab
 *     consistent across cards.json + model.
 *
 * If ``MODEL_RELEASE_TAG`` in ``src/version.ts`` is ``null``, the
 * plugin is a no-op so the app keeps building during the period
 * between merging ML features and shipping the first model release.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TRAINING_REPO = "bjorvack/lorcana-training";

interface FetchModelOptions {
  tag?: string;
  outDir?: string;
  metaPath?: string;
}

interface ModelManifestAsset {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface ModelManifest {
  readonly tag: string;
  readonly version: string;
  readonly vocabSize: number;
  readonly opset: number;
  readonly sources: {
    readonly cardsReleaseTag: string;
    readonly cardSetVersion: string;
    readonly tournamentsReleaseTag: string;
    readonly schemasReleaseTag: string;
  };
  readonly assets: Record<
    "proposal" | "evaluator" | "cardEmbeddings" | "playFrequency" | "archetypeCentroids" | "vocab",
    | ModelManifestAsset
    | (ModelManifestAsset & {
        readonly externalData: ModelManifestAsset | null;
        readonly inputNames: readonly string[];
        readonly outputNames: readonly string[];
      })
    | (ModelManifestAsset & {
        readonly rows: number;
        readonly dim: number;
        readonly dtype: string;
        readonly padRow: number;
      })
  >;
}

export function fetchModel(opts: FetchModelOptions = {}): Plugin {
  let ran = false;
  return {
    name: "lorcana:fetch-model",
    async buildStart() {
      // Vite calls buildStart for both dev and build modes, but
      // within the same process this fires once per buildStart hook
      // invocation. We guard against accidental double-fetches in
      // server-restart scenarios.
      if (ran) return;
      ran = true;

      const tag = opts.tag ?? (await readPinnedTag());
      if (tag === null) {
        this.info("[fetch-model] MODEL_RELEASE_TAG is null — skipping model fetch");
        return;
      }

      const outDir = opts.outDir ?? resolve(REPO_ROOT, "public", "model");
      const metaPath = opts.metaPath ?? resolve(REPO_ROOT, "src", "data", "model.meta.ts");
      mkdirSync(outDir, { recursive: true });

      if (await alreadyFresh(metaPath, tag)) {
        this.info(`[fetch-model] using cached ${outDir} for ${tag}`);
        return;
      }

      const manifest = await downloadManifest(tag);
      await ensureCardsetVersionMatch(manifest);

      // Always download the manifest itself plus every asset. The
      // manifest is tiny but doubles as the runtime contract for
      // shape inputs, so we ship it alongside the bytes.
      const sidecars: { path: string; bytes: number; sha256: string }[] = [];
      const downloads: { name: string; expected: ModelManifestAsset }[] = [
        {
          name: "model-manifest.json",
          expected: { path: "model-manifest.json", bytes: 0, sha256: "" },
        },
      ];
      for (const [, asset] of Object.entries(manifest.assets)) {
        downloads.push({ name: asset.path, expected: asset });
        if ("externalData" in asset && asset.externalData) {
          sidecars.push(asset.externalData);
          downloads.push({ name: asset.externalData.path, expected: asset.externalData });
        }
      }
      for (const entry of downloads) {
        await downloadAndStore(tag, entry.name, outDir, entry.expected.sha256);
      }

      writeFileSync(metaPath, renderMeta({ tag, manifest, sidecars }), "utf8");
      this.info(
        `[fetch-model] wrote ${outDir}/{manifest + ${downloads.length - 1} assets} for ${tag}`,
      );
    },
  };
}

async function readPinnedTag(): Promise<string | null> {
  const versionPath = resolve(REPO_ROOT, "src", "version.ts");
  const source = readFileSync(versionPath, "utf8");
  // Anchor on the actual ``export const`` declaration so neither
  // the JSDoc header nor inline comments can match. Without this
  // anchor, the regex's leading [^=] class — which spans newlines
  // — would let a comment-block mention of MODEL_RELEASE_TAG walk
  // forward to the *next* "=" in the file (typically CARDS_RELEASE_TAG's)
  // and capture the wrong tag.
  const nullMatch = source.match(/export\s+const\s+MODEL_RELEASE_TAG[^=\n]*=\s*null/);
  if (nullMatch) return null;
  const valueMatch = source.match(/export\s+const\s+MODEL_RELEASE_TAG[^=\n]*=\s*"([^"]+)"/);
  if (!valueMatch?.[1]) {
    throw new Error(`Could not parse MODEL_RELEASE_TAG from ${versionPath}`);
  }
  return valueMatch[1];
}

async function ensureCardsetVersionMatch(manifest: ModelManifest): Promise<void> {
  // ``src/data/cards.meta.ts`` is written by ``fetch-cards`` earlier
  // in the same buildStart pass (Vite runs plugins in declaration
  // order). If the cards plugin didn't emit one yet — e.g. a fresh
  // clone running ``pnpm dev`` before the cards meta file was
  // committed — we skip the cross-check rather than failing the
  // build, leaving the responsibility on the developer who set up
  // the dev environment.
  const cardsMetaPath = resolve(REPO_ROOT, "src", "data", "cards.meta.ts");
  if (!existsSync(cardsMetaPath)) return;
  const meta = readFileSync(cardsMetaPath, "utf8");
  const m = meta.match(/CARD_SET_VERSION\s*=\s*"([^"]+)"/);
  if (!m?.[1]) return;
  if (m[1] !== manifest.sources.cardSetVersion) {
    throw new Error(
      `cardSetVersion mismatch: cards-vN pinned at "${m[1]}" but model-vN ` +
        `bundle reports "${manifest.sources.cardSetVersion}". ` +
        `Bump one or the other in src/version.ts and rebuild.`,
    );
  }
}

async function alreadyFresh(metaPath: string, tag: string): Promise<boolean> {
  if (!existsSync(metaPath)) return false;
  const stat = statSync(metaPath);
  if (stat.size === 0) return false;
  const content = readFileSync(metaPath, "utf8");
  return content.includes(`"${tag}"`);
}

async function authedFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.NODE_AUTH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { headers });
}

async function downloadManifest(tag: string): Promise<ModelManifest> {
  // The manifest is the smallest asset and what every other download
  // is keyed on, so we always fetch it from the API rather than from
  // a possibly-stale local copy.
  const releaseUrl = `https://api.github.com/repos/${TRAINING_REPO}/releases/tags/${tag}`;
  const releaseRes = await authedFetch(releaseUrl);
  if (!releaseRes.ok) {
    throw new Error(`${releaseUrl}: HTTP ${releaseRes.status} ${releaseRes.statusText}`);
  }
  const release = (await releaseRes.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets.find((a) => a.name === "model-manifest.json");
  if (!asset) {
    const present = release.assets.map((a) => a.name).join(", ");
    throw new Error(`${tag}: missing model-manifest.json (have: ${present})`);
  }
  const res = await authedFetch(asset.browser_download_url);
  if (!res.ok) throw new Error(`${asset.browser_download_url}: HTTP ${res.status}`);
  return (await res.json()) as ModelManifest;
}

async function downloadAndStore(
  tag: string,
  name: string,
  outDir: string,
  expectedSha: string,
): Promise<void> {
  const releaseUrl = `https://api.github.com/repos/${TRAINING_REPO}/releases/tags/${tag}`;
  const releaseRes = await authedFetch(releaseUrl);
  if (!releaseRes.ok) {
    throw new Error(`${releaseUrl}: HTTP ${releaseRes.status} ${releaseRes.statusText}`);
  }
  const release = (await releaseRes.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) {
    throw new Error(`${tag}: missing asset ${name}`);
  }
  const res = await authedFetch(asset.browser_download_url);
  if (!res.ok) throw new Error(`${asset.browser_download_url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedSha) {
    const got = "sha256:" + createHash("sha256").update(buf).digest("hex");
    if (got !== expectedSha) {
      throw new Error(`${name}: sha256 mismatch (got ${got}, expected ${expectedSha})`);
    }
  }
  writeFileSync(resolve(outDir, name), buf);
}

function renderMeta(args: {
  tag: string;
  manifest: ModelManifest;
  sidecars: ModelManifestAsset[];
}): string {
  const m = args.manifest;
  // Only emit the JSON-serialisable subset of the manifest that
  // runtime code actually needs. Everything heavier (encoder
  // manifest, proposal manifest...) stays in the manifest.json file
  // we shipped to public/.
  const summary = {
    tag: m.tag,
    version: m.version,
    vocabSize: m.vocabSize,
    opset: m.opset,
    sources: m.sources,
    assets: m.assets,
    sidecars: args.sidecars,
  };
  return [
    "/**",
    " * AUTO-GENERATED by build/fetch-model.ts at build time.",
    " * Do not edit by hand; bump MODEL_RELEASE_TAG in src/version.ts.",
    " */",
    "",
    `export const MODEL_RELEASE_TAG = ${JSON.stringify(args.tag)};`,
    `export const MODEL_MANIFEST = ${JSON.stringify(summary, null, 2)} as const;`,
    "",
  ].join("\n");
}
