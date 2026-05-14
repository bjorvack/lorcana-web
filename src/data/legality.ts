/**
 * Format-aware legality bundle for the web app.
 *
 * ``build/fetch-cards.ts`` writes ``banlist.json`` + ``rotation.json``
 * into this directory alongside ``cards.json``. We parse them once
 * at module load (cheap, both files are tiny), pre-resolve the
 * banned id sets per format, and expose a memoised
 * ``cardLegality(card, format)`` so the finder + deck-list selectors
 * can dot every row without re-doing work.
 *
 * Older cards-vN releases that predate the legality assets resolve
 * to empty banlists / no rotation blocks, leaving every card
 * ``legal`` — the UI then matches the v0.4 behaviour exactly.
 */

import {
  Banlist,
  Rotation,
  computeLegalityFast,
  resolveBanlist,
  type CardT,
  type FormatNameT,
  type LegalityStatus,
} from "@bjorvack/lorcana-schemas";

import { cards } from "./cards";
import rawBanlist from "./banlist.json";
import rawRotation from "./rotation.json";

export { isTournamentLegal } from "@bjorvack/lorcana-schemas";
export type Format = FormatNameT;

export const banlist = Banlist.parse(rawBanlist);
export const rotation = Rotation.parse(rawRotation);

const bannedIdsByFormat: Record<Format, ReadonlySet<string>> = {
  core_constructed: resolveBanlist(banlist, cards, "core_constructed"),
  infinity_constructed: resolveBanlist(banlist, cards, "infinity_constructed"),
};

/** Resolved banned-id set for the active format. */
export function bannedIds(format: Format): ReadonlySet<string> {
  return bannedIdsByFormat[format];
}

/**
 * Per-card legality status under a format. ``asOf`` defaults to
 * "now" so the dot reflects the user's current calendar; pass an
 * explicit Date for testing.
 */
export function cardLegality(card: CardT, format: Format, asOf: Date = new Date()): LegalityStatus {
  return computeLegalityFast(card, bannedIdsByFormat[format], rotation, format, asOf);
}

/**
 * Cheap "is this card legal *right now* in this format" predicate
 * used as a filter in the card finder and as the format mask in
 * the generator's vocab-aligned legality bitmap.
 */
export function isLegalNow(card: CardT, format: Format, asOf: Date = new Date()): boolean {
  return cardLegality(card, format, asOf) === "legal";
}

/**
 * Decide the default format at boot. Pre-Set-9 (no rotation has
 * happened yet) we default to Infinity so we don't surprise users
 * by hiding the cards they're used to. Post-Set-9 we default to
 * Core, which matches what tournaments enforce.
 */
export function defaultFormat(asOf: Date = new Date()): Format {
  const rotated = rotation.blocks.some((b) => new Date(b.rotationDate) <= asOf);
  return rotated ? "core_constructed" : "infinity_constructed";
}
