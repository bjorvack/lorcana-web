/// <reference lib="webworker" />

/**
 * Background worker that owns the two ORT sessions + the embedding table.
 *
 * Lives entirely off the main thread so a generate-deck call doesn't
 * jank the UI. Spawned lazily on first AI interaction.
 */

import * as ort from "onnxruntime-web";

import type { GenerateProgressEvent, ModelBundle, WorkerEvent, WorkerRequest } from "./protocol";
import { STYLE_MIXES } from "./protocol";

import { type SearchContext, completeDeck } from "./search";

interface VocabEntry {
  readonly index: number;
  readonly logicalId: string;
  readonly name: string;
  readonly version: string;
  readonly canonicalPrintingId: string;
  readonly printingIds: readonly string[];
}

interface VocabPayload {
  readonly cards: readonly VocabEntry[];
}

let ctx: SearchContext | null = null;

// `onnxruntime-web` looks for its WASM files under ``wasmPaths`` at
// init time. Vite emits the wasm alongside our worker bundle under
// /assets/, and its default URL strategy doesn't find them there.
// Point ORT at the jsDelivr CDN so the wasm load works in both dev
// and production without us shipping the (multi-MB) wasm asset
// twice. The wasm is content-addressed by version so the CDN copy
// is byte-identical to the npm package.
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/";

// Disable multi-threaded SIMD until we wire COOP/COEP headers in
// the deployed site. The single-threaded path is plenty fast for
// 60-card generation in under a few seconds.
ort.env.wasm.numThreads = 1;

function emit(event: WorkerEvent): void {
  (self as unknown as Worker).postMessage(event);
}

async function handleInit(req: { requestId: number; bundle: ModelBundle }): Promise<void> {
  const { bundle, requestId } = req;

  // The model bundle already includes the parsed vocab payload (main
  // thread fetches it because the worker can't compute the right URL
  // under /assets/...). For v0.1 we still don't have a per-card ink
  // table, so the legality mask is permissive: every vocab card is
  // marked as in-mask and we rely on the proposal net's own ink-
  // conditioned distribution to keep picks in-ink. Adding the ink
  // table to a future model-vN bundle lets us tighten this into a
  // hard rule.
  const cardInkMask = new Uint8Array(bundle.manifest.vocabSize + 1);
  for (let i = 1; i <= bundle.manifest.vocabSize; i++) {
    cardInkMask[i] = 0x3f; // all six inks set
  }
  void bundle.vocab; // referenced for the future ink-table follow-up

  // Build the two ORT sessions. WebAssembly backend keeps the worker
  // portable across browsers; WebGPU could be a later opt-in via
  // ort.env.webgl/webgpu.
  const sessionOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  const proposalSession = await ort.InferenceSession.create(
    new Uint8Array(bundle.proposal),
    sessionOptions,
  );
  const evaluatorSession = await ort.InferenceSession.create(
    new Uint8Array(bundle.evaluator),
    sessionOptions,
  );

  const [rows, dim] = bundle.cardEmbeddingsShape;
  const cardEmbeddings = new ort.Tensor("float32", bundle.cardEmbeddings, [rows, dim]);

  ctx = {
    proposalSession,
    evaluatorSession,
    cardEmbeddings,
    cardEmbeddingsRows: rows,
    cardEmbeddingsDim: dim,
    cardInkMask,
    playFrequency: bundle.playFrequency,
    archetypeCentroids: bundle.archetypeCentroids,
  };

  emit({
    kind: "init-done",
    requestId,
    vocabSize: bundle.manifest.vocabSize,
    modelTag: bundle.manifest.tag,
  });
}

async function handleGenerate(req: {
  requestId: number;
  partial: ReadonlyArray<readonly [number, number]>;
  inkMultihot: readonly [number, number, number, number, number, number];
  style: keyof typeof STYLE_MIXES;
  targetSize?: number;
  maxCopies?: number;
}): Promise<void> {
  if (!ctx) {
    throw new Error("worker not initialised; send 'init' first");
  }
  const styleMix = STYLE_MIXES[req.style];
  const result = await completeDeck(ctx, {
    partial: req.partial,
    inkMultihot: req.inkMultihot,
    style: styleMix,
    targetSize: req.targetSize ?? 60,
    maxCopies: req.maxCopies ?? 4,
    onProgress: (currentSize, lastPickCardId) => {
      const ev: GenerateProgressEvent = {
        kind: "generate-progress",
        requestId: req.requestId,
        currentSize,
        targetSize: req.targetSize ?? 60,
        lastPickCardId,
      };
      emit(ev);
    },
  });
  emit({
    kind: "generate-done",
    requestId: req.requestId,
    deck: result.deck,
    realism: result.realism,
  });
}

function asWorkerUrl(filename: string): string {
  // Workers don't see `import.meta.env`; the main thread already
  // resolved BASE_URL when sending us the bundle, but vocab.json
  // is fetched here for now. Use a relative path off the worker's
  // location origin.
  return `${self.location.origin}${self.location.pathname.replace(/[^/]*$/, "")}model/${filename}`;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.kind === "init") {
      await handleInit(req);
    } else if (req.kind === "generate") {
      await handleGenerate(req);
    }
  } catch (e) {
    emit({
      kind: "error",
      requestId: req.requestId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
