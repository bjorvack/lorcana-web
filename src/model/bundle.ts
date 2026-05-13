/**
 * Fetches the model bundle assets at runtime.
 *
 * Strategy: the model assets live under ``/model/*`` (served from the
 * Pages origin alongside the rest of the bundle). The first time the
 * app needs them — when the user hits Generate — we fetch:
 *
 *   - ``proposal.onnx`` (+ ``.data`` sidecar) into ArrayBuffers
 *   - ``evaluator.onnx`` (+ ``.data`` sidecar) into ArrayBuffers
 *   - ``card_embeddings.bin`` into a Float16Array we up-cast to Float32
 *     for ORT consumption (ORT prefers fp32 inputs even when the
 *     weights are quantised)
 *   - ``play_frequency.json`` and ``archetype_centroids.json`` as JSON
 *
 * The browser HTTP cache handles repeated invocations; we don't try
 * to wire an in-memory bundle cache here. The worker keeps the loaded
 * sessions alive once initialised.
 */

import { MODEL_MANIFEST, modelAssetUrl, type ModelManifest } from "./manifest";
import { verifyManifestAgainstCards } from "./verify";

export interface ArchetypeCentroids {
  readonly dim: number;
  readonly k: number;
  readonly centroids: readonly (readonly number[])[];
}

export interface PlayFrequency {
  readonly [inkPairKey: string]: { readonly [cardId: string]: number };
}

export interface ModelBundle {
  readonly manifest: ModelManifest;
  readonly proposal: ArrayBuffer;
  readonly proposalExternalData: ArrayBuffer | null;
  readonly evaluator: ArrayBuffer;
  readonly evaluatorExternalData: ArrayBuffer | null;
  /** Up-cast to fp32 so onnxruntime-web's float input accepts it. */
  readonly cardEmbeddings: Float32Array;
  readonly cardEmbeddingsShape: readonly [rows: number, dim: number];
  readonly playFrequency: PlayFrequency;
  readonly archetypeCentroids: ArchetypeCentroids;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Convert IEEE-754 half-precision (fp16) bytes to Float32Array.
 *
 * Browsers expose ``Float16Array`` only behind a flag in some
 * versions, so we decode manually. The math is the standard
 * 1-5-10 → 1-8-23 expansion: sign goes through, the exponent is
 * rebiased from 15 to 127, and the mantissa is zero-padded on the
 * right.
 */
function fp16ToFp32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const count = buffer.byteLength / 2;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const h = view.getUint16(i * 2, /* littleEndian */ true);
    const sign = (h & 0x8000) >> 15;
    const exp = (h & 0x7c00) >> 10;
    const frac = h & 0x03ff;
    let value: number;
    if (exp === 0) {
      // Subnormal: 2^-14 * frac/1024.
      value = (frac / 1024) * Math.pow(2, -14);
    } else if (exp === 31) {
      // Infinity / NaN.
      value = frac === 0 ? Infinity : NaN;
    } else {
      // Normal: 2^(exp - 15) * (1 + frac/1024).
      value = (1 + frac / 1024) * Math.pow(2, exp - 15);
    }
    out[i] = sign ? -value : value;
  }
  return out;
}

export async function loadModelBundle(): Promise<ModelBundle> {
  verifyManifestAgainstCards(MODEL_MANIFEST);

  const proposalAsset = MODEL_MANIFEST.assets.proposal;
  const evaluatorAsset = MODEL_MANIFEST.assets.evaluator;
  const embeddingsAsset = MODEL_MANIFEST.assets.cardEmbeddings;
  const playFreqAsset = MODEL_MANIFEST.assets.playFrequency;
  const archAsset = MODEL_MANIFEST.assets.archetypeCentroids;

  // Fire all six fetches in parallel — ~30 MB total in v0.1.0,
  // dominated by the proposal sidecar. The browser caches them so
  // the next call is essentially free.
  const [
    proposal,
    evaluator,
    embeddingsBuf,
    playFrequency,
    archetypeCentroids,
    proposalExt,
    evaluatorExt,
  ] = await Promise.all([
    fetchBuffer(modelAssetUrl(proposalAsset.path)),
    fetchBuffer(modelAssetUrl(evaluatorAsset.path)),
    fetchBuffer(modelAssetUrl(embeddingsAsset.path)),
    fetchJson<PlayFrequency>(modelAssetUrl(playFreqAsset.path)),
    fetchJson<ArchetypeCentroids>(modelAssetUrl(archAsset.path)),
    "externalData" in proposalAsset && proposalAsset.externalData
      ? fetchBuffer(modelAssetUrl(proposalAsset.externalData.path))
      : Promise.resolve(null),
    "externalData" in evaluatorAsset && evaluatorAsset.externalData
      ? fetchBuffer(modelAssetUrl(evaluatorAsset.externalData.path))
      : Promise.resolve(null),
  ]);

  const dtype = "dtype" in embeddingsAsset ? embeddingsAsset.dtype : "float32";
  const cardEmbeddings =
    dtype === "float16" ? fp16ToFp32(embeddingsBuf) : new Float32Array(embeddingsBuf);
  const rows = "rows" in embeddingsAsset ? embeddingsAsset.rows : cardEmbeddings.length;
  const dim = "dim" in embeddingsAsset ? embeddingsAsset.dim : 1;

  return {
    manifest: MODEL_MANIFEST,
    proposal,
    proposalExternalData: proposalExt,
    evaluator,
    evaluatorExternalData: evaluatorExt,
    cardEmbeddings,
    cardEmbeddingsShape: [rows, dim],
    playFrequency,
    archetypeCentroids,
  };
}
