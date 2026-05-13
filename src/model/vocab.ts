/**
 * Runtime vocab map: logical index ↔ printing id.
 *
 * The model bundle stores a ``vocab.json`` whose ``cards`` array
 * preserves the training-time canonical ordering. We need it on the
 * main thread for two reasons:
 *
 *   - Converting a generated deck (logical indices) back into the
 *     printing-id strings ``DeckState`` keys on.
 *   - Pre-flighting any deck the user has already started: mapping
 *     each printing id to its logical index before handing it to the
 *     worker so the model can condition on it.
 *
 * Loaded lazily so the UI shell can render before the model bundle
 * is asked for.
 */

import { modelAssetUrl } from "./manifest";

export interface VocabEntry {
  readonly index: number;
  readonly logicalId: string;
  readonly name: string;
  readonly version: string;
  readonly canonicalPrintingId: string;
  readonly printingIds: readonly string[];
}

export interface VocabMap {
  readonly entries: readonly VocabEntry[];
  /** ``printing_id`` → ``logical_index`` (1..vocab_size). */
  readonly printingToLogical: ReadonlyMap<string, number>;
  /** ``logical_index`` → canonical printing id (the one we add to
   * the deck when the model picks this slot). */
  readonly logicalToCanonical: ReadonlyMap<number, string>;
}

let _cache: VocabMap | null = null;

export async function loadVocabMap(): Promise<VocabMap> {
  if (_cache) return _cache;
  const res = await fetch(modelAssetUrl("vocab.json"));
  if (!res.ok) throw new Error(`vocab.json: HTTP ${res.status}`);
  const payload = (await res.json()) as { cards: readonly VocabEntry[] };
  const printingToLogical = new Map<string, number>();
  const logicalToCanonical = new Map<number, string>();
  for (const entry of payload.cards) {
    if (entry.index <= 0) continue; // PAD placeholder
    logicalToCanonical.set(entry.index, entry.canonicalPrintingId);
    for (const pid of entry.printingIds) {
      printingToLogical.set(pid, entry.index);
    }
  }
  _cache = { entries: payload.cards, printingToLogical, logicalToCanonical };
  return _cache;
}
