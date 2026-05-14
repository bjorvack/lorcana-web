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

let ctx: SearchContext | null = null;

// `onnxruntime-web` looks for its WASM files under ``wasmPaths`` at
// init time. Vite emits the wasm alongside our worker bundle under
// /assets/, and its default URL strategy doesn't find them there.
// Point ORT at the jsDelivr CDN so the wasm load works in both dev
// and production without us shipping the (multi-MB) wasm asset
// twice. The wasm is content-addressed by version so the CDN copy
// is byte-identical to the npm package.
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/";

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
  // marked with the special bit ``0`` meaning "no declared inks",
  // which ``buildInkLegality`` treats as "legal in every deck". The
  // proposal net's own ink-conditioned distribution does the heavy
  // lifting on keeping picks in-ink. A future model-vN bundle should
  // ship a per-card ink table so the mask can enforce it hard-rule.
  const cardInkMask = new Uint8Array(bundle.manifest.vocabSize + 1);
  void bundle.vocab; // referenced for the future ink-table follow-up

  // Build the two ORT sessions. WebAssembly backend keeps the worker
  // portable across browsers; WebGPU could be a later opt-in via
  // ort.env.webgl/webgpu.
  //
  // Dynamo-exported ONNX graphs use external-data sidecars (the
  // ``.onnx.data`` files we ship in the bundle). When loading from
  // a raw Uint8Array, ORT can't autodiscover those by URL, so we
  // pass them explicitly via ``SessionOptions.externalData``. The
  // ``path`` must match the ``location`` recorded inside the graph
  // proto — which is just the sidecar's filename, e.g.
  // ``proposal.onnx.data``. Without this, ORT throws a cryptic
  // ``t.getValue is not a function`` from inside its allocator
  // because the weight tensors come back undefined.
  const proposalExtra =
    bundle.proposalExternalData !== null
      ? {
          externalData: [
            {
              path: "proposal.onnx.data",
              data: new Uint8Array(bundle.proposalExternalData),
            },
          ],
        }
      : {};
  const evaluatorExtra =
    bundle.evaluatorExternalData !== null
      ? {
          externalData: [
            {
              path: "evaluator.onnx.data",
              data: new Uint8Array(bundle.evaluatorExternalData),
            },
          ],
        }
      : {};
  const baseOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  const proposalSession = await ort.InferenceSession.create(new Uint8Array(bundle.proposal), {
    ...baseOptions,
    ...proposalExtra,
  });
  const evaluatorSession = await ort.InferenceSession.create(new Uint8Array(bundle.evaluator), {
    ...baseOptions,
    ...evaluatorExtra,
  });

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
  legalLogicalIds?: Uint8Array;
}): Promise<void> {
  if (!ctx) {
    throw new Error("worker not initialised; send 'init' first");
  }
  const styleMix = STYLE_MIXES[req.style];
  // The main thread may pass a precomputed legality mask (1 byte per
  // logical id) that knows which cards are actually playable in the
  // deck's inks; otherwise fall back to the all-zeros default in ctx
  // and let the legality builder treat that as "no per-card ink
  // info, allow everything".
  const overrideCtx = req.legalLogicalIds
    ? { ...ctx, cardInkMask: deriveFromLegalIds(req.legalLogicalIds) }
    : ctx;
  const result = await completeDeck(overrideCtx, {
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

function deriveFromLegalIds(legalIds: Uint8Array): Uint8Array {
  // ``legalLogicalIds`` is already a vocab-aligned 0/1 mask from the
  // main thread. We translate it into the bit-field representation
  // the worker's existing legality code expects: any nonzero entry
  // gets bit 0 set (a "this card is always legal" sentinel that
  // ``buildInkLegality`` treats as a permissive match), and zero
  // stays zero so the card stays excluded.
  const out = new Uint8Array(legalIds.length);
  for (let i = 1; i < legalIds.length; i++) {
    if (legalIds[i]) out[i] = 0x3f; // any-ink-permissive sentinel
  }
  // Re-use the bit-field check by making the deck-bits superset of
  // 0x3f never match: instead we treat 0 as "permissive" (handled in
  // search.ts). To make sure the mask is non-zero at legal positions,
  // we set bit 0 only.
  for (let i = 1; i < legalIds.length; i++) {
    out[i] = legalIds[i] ? 1 : 0;
  }
  return out;
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
