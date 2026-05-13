/**
 * Constrained deck-completion search.
 *
 * One step at a time, the loop:
 *
 *   1. Asks the proposal net for ``log P(card | partial, inks)`` over
 *      the whole vocabulary.
 *   2. Builds a legality mask: in-ink only, ≤ max-copies per card,
 *      and excludes PAD.
 *   3. For each legal candidate, computes the blended score
 *
 *        score(c) = w_p · log P(c) + α · σ(V(partial, c))
 *                 + γ · novelty(c, partial) − λ · play_freq(c | inks)
 *
 *      where ``(w_p, α, γ, λ)`` come from the active Style mix.
 *   4. Either picks the argmax (temperature 0) or samples from a
 *      tempered softmax.
 *   5. Adds the picked card and recurses until the deck reaches the
 *      target size.
 *
 * The evaluator is only invoked on the top-``EVALUATOR_CANDIDATES``
 * candidates from the proposal. That keeps the per-step cost
 * dominated by a single proposal forward pass + 32 single-row
 * evaluator passes (~ms each on WASM), so a 60-card deck fills in
 * roughly 2-3 seconds on a laptop.
 */

import * as ort from "onnxruntime-web";

import type { ArchetypeCentroids, PlayFrequency, StyleMix } from "./protocol";

import { cosineDistanceToNearestCentroid } from "./novelty";

/** Top-K candidates from the proposal we run the evaluator on. */
const EVALUATOR_CANDIDATES = 32;

/** Bitmask of cards an ink-pair allows. ``ink_mask`` per card is the
 * same int64 representation we used in evaluator/data.py — a 6-bit
 * mask. Here we precompute it from the ``play_frequency`` table for
 * the deck's ink-pair plus a vocab-aligned ``inkMask`` array. */
export interface InkLegality {
  readonly inMaskCount: number;
  readonly mask: Uint8Array; // (vocab_size + 1,) 1 = legal, 0 = excluded
}

export function buildInkLegality(
  cardInkMask: Uint8Array,
  deckInkMultihot: readonly number[],
): InkLegality {
  // A card is legal iff *every* ink in its mask is in the deck's
  // chosen ink set. (Card has amber+ruby; deck must contain both.)
  // Dual-ink cards are common enough that "any overlap" would let
  // cards in that the deck literally can't play.
  let deckBits = 0;
  for (let i = 0; i < deckInkMultihot.length; i++) {
    if (deckInkMultihot[i]! > 0) deckBits |= 1 << i;
  }
  const mask = new Uint8Array(cardInkMask.length);
  let count = 0;
  for (let i = 1; i < cardInkMask.length; i++) {
    // PAD (index 0) stays masked out.
    const cardBits = cardInkMask[i]!;
    if (cardBits === 0) continue;
    if ((cardBits & deckBits) === cardBits) {
      mask[i] = 1;
      count++;
    }
  }
  return { mask, inMaskCount: count };
}

export interface PartialDeck {
  /** Mutable map: card_id → count. */
  counts: Map<number, number>;
  size: number;
}

export function partialFromInitial(initial: ReadonlyArray<readonly [number, number]>): PartialDeck {
  const counts = new Map<number, number>();
  let size = 0;
  for (const [id, c] of initial) {
    if (c > 0) {
      counts.set(id, c);
      size += c;
    }
  }
  return { counts, size };
}

/** Expand a partial deck into the (B=1, N) ids tensor the proposal
 * and evaluator graphs expect. Returns a Float32Array of zeros if
 * the deck is empty — the model accepts an all-PAD partial as
 * "predict the first card." */
function partialToIdsTensor(partial: PartialDeck): ort.Tensor {
  const ids: number[] = [];
  for (const [id, count] of partial.counts) {
    for (let i = 0; i < count; i++) ids.push(id);
  }
  if (ids.length === 0) ids.push(0);
  return new ort.Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]);
}

/** Per-search runtime state. The worker keeps these around across
 * calls so we don't re-allocate ORT tensors per step. */
export interface SearchContext {
  readonly proposalSession: ort.InferenceSession;
  readonly evaluatorSession: ort.InferenceSession;
  readonly cardEmbeddings: ort.Tensor;
  readonly cardEmbeddingsRows: number;
  readonly cardEmbeddingsDim: number;
  /** Vocab-aligned int8 mask: bit i = ink-i membership. */
  readonly cardInkMask: Uint8Array;
  readonly playFrequency: PlayFrequency;
  readonly archetypeCentroids: ArchetypeCentroids;
}

/** Internal type for the evaluator scoring pass. */
interface ScoredCandidate {
  cardId: number;
  proposalLogProb: number;
  evaluatorProb: number;
  novelty: number;
  metaFreq: number;
  blended: number;
}

function softmaxSample(
  candidates: readonly ScoredCandidate[],
  temperature: number,
  rng: () => number,
): number {
  if (candidates.length === 0) {
    throw new Error("no candidates to sample from");
  }
  if (temperature <= 0) {
    let best = 0;
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i]!.blended > candidates[best]!.blended) best = i;
    }
    return candidates[best]!.cardId;
  }
  // Numerically stable temperature-scaled softmax + multinomial draw.
  let max = -Infinity;
  for (const c of candidates) if (c.blended > max) max = c.blended;
  const weights: number[] = candidates.map((c) => Math.exp((c.blended - max) / temperature));
  let total = 0;
  for (const w of weights) total += w;
  let pick = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i]!;
    if (pick <= 0) return candidates[i]!.cardId;
  }
  return candidates[candidates.length - 1]!.cardId;
}

function inkPairKey(deckInkMultihot: readonly number[]): string {
  const inks = ["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"];
  const active: string[] = [];
  for (let i = 0; i < deckInkMultihot.length; i++) {
    if (deckInkMultihot[i]! > 0) active.push(inks[i]!);
  }
  return active.sort().join("|");
}

/** Run a single step of the search: pick one card to add. */
async function pickNextCard(
  ctx: SearchContext,
  partial: PartialDeck,
  inkMultihot: readonly number[],
  legality: InkLegality,
  maxCopies: number,
  style: StyleMix,
  rng: () => number,
): Promise<number> {
  // --- Proposal forward pass ----------------------------------------
  const idsTensor = partialToIdsTensor(partial);
  const inkTensor = new ort.Tensor("float32", new Float32Array(inkMultihot), [1, 6]);
  const proposalOut = await ctx.proposalSession.run({
    card_ids: idsTensor,
    ink_multihot: inkTensor,
    card_embeddings: ctx.cardEmbeddings,
  });
  const logits = proposalOut.logits!.data as Float32Array;

  // --- Convert to log P + apply legality + max-copies mask ----------
  // Log-softmax with numerical stability.
  let maxLogit = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (legality.mask[i] && logits[i]! > maxLogit) maxLogit = logits[i]!;
  }
  if (maxLogit === -Infinity) {
    throw new Error("legality mask excluded every card");
  }
  let sumExp = 0;
  for (let i = 0; i < logits.length; i++) {
    if (legality.mask[i]) sumExp += Math.exp(logits[i]! - maxLogit);
  }
  const logZ = maxLogit + Math.log(sumExp);

  // Collect top-K legal candidates by proposal log-prob.
  const heap: { id: number; logp: number }[] = [];
  for (let i = 1; i < logits.length; i++) {
    if (!legality.mask[i]) continue;
    const have = partial.counts.get(i) ?? 0;
    if (have >= maxCopies) continue;
    const logp = logits[i]! - logZ;
    if (heap.length < EVALUATOR_CANDIDATES) {
      heap.push({ id: i, logp });
      heap.sort((a, b) => a.logp - b.logp); // ascending — lowest first
    } else if (logp > heap[0]!.logp) {
      heap[0] = { id: i, logp };
      heap.sort((a, b) => a.logp - b.logp);
    }
  }
  if (heap.length === 0) {
    throw new Error("no legal candidates remain");
  }

  // --- Evaluator pass on the top-K ---------------------------------
  // Batched: stack candidates into one (K,) tensor with shared partial.
  const candidateIds = new BigInt64Array(heap.map((c) => BigInt(c.id)));
  const partialBatch = expandPartialBatch(partial, heap.length);
  const evalOut = await ctx.evaluatorSession.run({
    partial_ids: partialBatch,
    candidate_ids: new ort.Tensor("int64", candidateIds, [heap.length]),
    card_embeddings: ctx.cardEmbeddings,
  });
  const evalLogits = evalOut.logits!.data as Float32Array;

  // --- Novelty + meta-closeness ------------------------------------
  const inkKey = inkPairKey(inkMultihot);
  const playFreqRow = ctx.playFrequency[inkKey] ?? ctx.playFrequency["_all"] ?? {};

  const scored: ScoredCandidate[] = heap.map((c, idx) => {
    const evalProb = 1 / (1 + Math.exp(-evalLogits[idx]!));
    const embRow = ctx.cardEmbeddings.data as Float32Array;
    const start = c.id * ctx.cardEmbeddingsDim;
    const view = embRow.subarray(start, start + ctx.cardEmbeddingsDim);
    const novelty = cosineDistanceToNearestCentroid(view, ctx.archetypeCentroids);
    const metaFreq = playFreqRow[String(c.id)] ?? 0;
    const blended =
      style.proposalWeight * c.logp +
      style.evaluatorWeight * evalProb +
      style.noveltyWeight * novelty -
      style.metaPenalty * metaFreq;
    return {
      cardId: c.id,
      proposalLogProb: c.logp,
      evaluatorProb: evalProb,
      novelty,
      metaFreq,
      blended,
    };
  });

  return softmaxSample(scored, style.temperature, rng);
}

/** Stack the same partial K times for the evaluator's batched run. */
function expandPartialBatch(partial: PartialDeck, k: number): ort.Tensor {
  const ids: number[] = [];
  for (const [id, count] of partial.counts) {
    for (let i = 0; i < count; i++) ids.push(id);
  }
  if (ids.length === 0) ids.push(0);
  const n = ids.length;
  const data = new BigInt64Array(k * n);
  for (let b = 0; b < k; b++) {
    for (let i = 0; i < n; i++) data[b * n + i] = BigInt(ids[i]!);
  }
  return new ort.Tensor("int64", data, [k, n]);
}

export interface CompleteDeckOptions {
  readonly partial: ReadonlyArray<readonly [number, number]>;
  readonly inkMultihot: readonly [number, number, number, number, number, number];
  readonly style: StyleMix;
  readonly targetSize: number;
  readonly maxCopies: number;
  /** Called after each pick. Return false to abort. */
  readonly onProgress?: (currentSize: number, lastPick: number) => void;
}

export async function completeDeck(
  ctx: SearchContext,
  opts: CompleteDeckOptions,
): Promise<{ deck: ReadonlyArray<readonly [number, number]>; realism: number }> {
  const partial = partialFromInitial(opts.partial);
  const legality = buildInkLegality(ctx.cardInkMask, opts.inkMultihot);
  if (legality.inMaskCount === 0) {
    throw new Error("No legal cards for the chosen inks; pick at least one ink.");
  }
  // Math.random is fine — the search is already non-deterministic
  // through the model itself and the user doesn't need byte-perfect
  // reproducibility.
  const rng = Math.random;
  const realismRunning: number[] = [];
  while (partial.size < opts.targetSize) {
    const pick = await pickNextCard(
      ctx,
      partial,
      opts.inkMultihot,
      legality,
      opts.maxCopies,
      opts.style,
      rng,
    );
    partial.counts.set(pick, (partial.counts.get(pick) ?? 0) + 1);
    partial.size++;
    opts.onProgress?.(partial.size, pick);
    realismRunning.push(0); // filled by a final evaluator pass below
  }

  // Final realism score: average of the evaluator's prob for each
  // existing card in the deck given the others as context. Cheap
  // approximation that doubles as the "Realism: X%" pill.
  const realism = await scoreRealism(ctx, partial);

  return {
    deck: Array.from(partial.counts.entries()) as ReadonlyArray<readonly [number, number]>,
    realism,
  };
}

async function scoreRealism(ctx: SearchContext, partial: PartialDeck): Promise<number> {
  // Approximate: take 8 random card-positions, for each evaluate
  // "if this card were the next pick, how plausible?". Averaging
  // these is good enough for a UI pill; the full leave-one-out
  // pass would do 60 evaluator runs which is fine on CPU but extra
  // wall-clock for no UX benefit.
  const ids: number[] = [];
  for (const [id, count] of partial.counts) {
    for (let i = 0; i < count; i++) ids.push(id);
  }
  if (ids.length === 0) return 0;

  const sampleSize = Math.min(8, ids.length);
  const samples: number[] = [];
  for (let i = 0; i < sampleSize; i++) {
    samples.push(ids[Math.floor(Math.random() * ids.length)]!);
  }
  const candidateIds = new BigInt64Array(samples.map((x) => BigInt(x)));
  const partialBatch = expandPartialBatch(partial, sampleSize);
  const out = await ctx.evaluatorSession.run({
    partial_ids: partialBatch,
    candidate_ids: new ort.Tensor("int64", candidateIds, [sampleSize]),
    card_embeddings: ctx.cardEmbeddings,
  });
  const logits = out.logits!.data as Float32Array;
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += 1 / (1 + Math.exp(-logits[i]!));
  return sum / logits.length;
}
