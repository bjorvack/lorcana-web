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

/** Continuous Style position. 0 = Safe (meta-faithful), 1 = Brew
 * (exploratory). The 3 named mixes are kept around as convenient
 * named anchor points (UI labels, presets) but the worker actually
 * blends along ``styleT`` so the slider is continuous. */
export type StyleT = number;

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
  /** Named preset OR a continuous ``[0, 1]`` value. Both supported so
   * callers without the slider (legacy UI, tests, CLI bench) can keep
   * using the three-name interface. */
  readonly style: StyleName | StyleT;
  /** Target deck size. DESIGN.md fixes this at 60 for tournament-legal. */
  readonly targetSize?: number;
  /** Maximum copies of any single card. Constructed cards say 4. */
  readonly maxCopies?: number;
  /** Higher = more diverse picks. 0 = argmax. */
  readonly temperature?: number;
  /**
   * Optional vocab-aligned legality mask the main thread can pass in.
   * 1 = legal pick, 0 = excluded. Index 0 is reserved for PAD.
   *
   * The worker doesn't have access to the full CardSet (it only sees
   * vocab.json), so legality based on actual ``Card.inks`` data lives
   * on the main thread. Passing the pre-computed mask is cheaper than
   * shipping per-card inks through the bundle and lets the legality
   * rule evolve (e.g. format bans) without a model retrain.
   */
  readonly legalLogicalIds?: Uint8Array;
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

/** Resolve the active mix from a name or a 0..1 slider position.
 *
 * Names short-circuit to the preset above. Numeric values are lerp'd
 * piecewise between (safe → balanced) on ``[0, 0.5]`` and
 * (balanced → brew) on ``[0.5, 1]``, which gives the UI a slider
 * whose midpoint always lands on the DESIGN-default balanced mix.
 * A linear interp would shift the midpoint depending on the spacing
 * between the two anchor tuples, which is harder to reason about
 * when tweaking presets later.
 */
export function resolveStyleMix(style: StyleName | StyleT): StyleMix {
  if (typeof style === "string") return STYLE_MIXES[style];
  const t = Math.min(1, Math.max(0, style));
  const [a, b, u] =
    t < 0.5
      ? [STYLE_MIXES.safe, STYLE_MIXES.balanced, t / 0.5]
      : [STYLE_MIXES.balanced, STYLE_MIXES.brew, (t - 0.5) / 0.5];
  const lerp = (x: number, y: number): number => x + (y - x) * u;
  return {
    proposalWeight: lerp(a.proposalWeight, b.proposalWeight),
    evaluatorWeight: lerp(a.evaluatorWeight, b.evaluatorWeight),
    noveltyWeight: lerp(a.noveltyWeight, b.noveltyWeight),
    metaPenalty: lerp(a.metaPenalty, b.metaPenalty),
    temperature: lerp(a.temperature, b.temperature),
  };
}

// Re-export bundle types so the worker module doesn't have to import
// across the model/ boundary directly.
export type { ArchetypeCentroids, ModelBundle, PlayFrequency };
