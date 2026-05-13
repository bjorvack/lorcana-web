/**
 * Message protocol between the main thread (``client.ts``) and the
 * inference web-worker (``inference.worker.ts``).
 *
 * Two request shapes:
 *
 *   - ``"init"`` — main thread pushes the loaded ``ModelBundle`` to
 *     the worker. The worker builds ORT sessions, lookup maps, and
 *     emits ``"init-done"`` (or ``"error"``).
 *
 *   - ``"generate"`` — main thread asks the worker to fill a partial
 *     deck up to 60 cards using the chosen inks + Style mix. The
 *     worker streams intermediate progress events and emits a final
 *     ``"generate-done"`` with the full deck.
 *
 * All messages carry a ``requestId`` so the client can disambiguate
 * concurrent calls. The worker keeps no per-request state.
 */

import type { ArchetypeCentroids, ModelBundle, PlayFrequency } from "../model/bundle";

export type StyleName = "safe" | "balanced" | "brew";

export interface InitRequest {
  readonly kind: "init";
  readonly requestId: number;
  readonly bundle: ModelBundle;
}

export interface InitDoneEvent {
  readonly kind: "init-done";
  readonly requestId: number;
  readonly vocabSize: number;
  readonly modelTag: string;
}

export interface GenerateRequest {
  readonly kind: "generate";
  readonly requestId: number;
  /** Card ids (logical ids 1..N) already in the deck, with counts. */
  readonly partial: ReadonlyArray<readonly [number, number]>;
  /** 6-dim multi-hot for {amber, amethyst, emerald, ruby, sapphire, steel}. */
  readonly inkMultihot: readonly [number, number, number, number, number, number];
  readonly style: StyleName;
  /** Target deck size. DESIGN.md fixes this at 60 for tournament-legal. */
  readonly targetSize?: number;
  /** Maximum copies of any single card. Constructed cards say 4. */
  readonly maxCopies?: number;
  /** Higher = more diverse picks. 0 = argmax. */
  readonly temperature?: number;
}

export interface GenerateProgressEvent {
  readonly kind: "generate-progress";
  readonly requestId: number;
  readonly currentSize: number;
  readonly targetSize: number;
  readonly lastPickCardId: number;
}

export interface GenerateDoneEvent {
  readonly kind: "generate-done";
  readonly requestId: number;
  /** Card ids + counts. Sum equals ``targetSize``. */
  readonly deck: ReadonlyArray<readonly [number, number]>;
  readonly realism: number;
}

export interface WorkerErrorEvent {
  readonly kind: "error";
  readonly requestId: number;
  readonly message: string;
}

export type WorkerRequest = InitRequest | GenerateRequest;
export type WorkerEvent =
  | InitDoneEvent
  | GenerateProgressEvent
  | GenerateDoneEvent
  | WorkerErrorEvent;

/** Style mix weights per :class:`StyleName`. */
export interface StyleMix {
  readonly proposalWeight: number; // log P_propose multiplier
  readonly evaluatorWeight: number; // α: how much the evaluator's prob counts
  readonly noveltyWeight: number; // γ: bonus for novel cards
  readonly metaPenalty: number; // λ: penalty on meta-staple frequency
  readonly temperature: number; // softmax temperature for sampling
}

export const STYLE_MIXES: Readonly<Record<StyleName, StyleMix>> = {
  safe: {
    proposalWeight: 1.0,
    evaluatorWeight: 1.5,
    noveltyWeight: 0.1,
    metaPenalty: 0.0,
    temperature: 0.3,
  },
  balanced: {
    proposalWeight: 1.0,
    evaluatorWeight: 1.0,
    noveltyWeight: 0.5,
    metaPenalty: 0.5,
    temperature: 0.7,
  },
  brew: {
    proposalWeight: 0.5,
    evaluatorWeight: 0.5,
    noveltyWeight: 1.2,
    metaPenalty: 1.5,
    temperature: 1.0,
  },
};

// Re-export bundle types so the worker module doesn't have to import
// across the model/ boundary directly.
export type { ArchetypeCentroids, ModelBundle, PlayFrequency };
