/**
 * Group printings by their logical-card identity (``name`` + ``version``).
 *
 * In Lorcana the same card can be printed multiple times — base set,
 * promos, enchanted variants. They all share rules text and are
 * treated as the same card for tournament-legality purposes
 * (max-copies caps across printings). For the UI, collapsing the
 * finder list to one row per logical card cuts visible noise and
 * matches what tournament-grade builders show.
 *
 * The canonical printing rule mirrors the one used in the training
 * pipeline: prefer the latest numeric ``setCode``; fall back to
 * alphabetic codes (P1 / D23 / …). That picks the most recent
 * base-set wording over older promo reprints, which keeps the
 * displayed art aligned with the current game state.
 *
 * Deck state still stores *printing* ids (one per added copy) — the
 * grouping is purely a presentation choice in the finder. A future
 * iteration can switch the deck to logical ids if we decide to make
 * the printing fully cosmetic.
 */

import type { CardT } from "@bjorvack/lorcana-schemas";

import { cards } from "./cards";

export interface LogicalCard {
  readonly logicalId: string; // "name|version"
  readonly name: string;
  readonly version: string; // "" for actions/songs without a subtitle
  readonly canonical: CardT;
  readonly printings: readonly CardT[]; // canonical-first
}

const _logicalCards: LogicalCard[] = (() => {
  const groups = new Map<string, CardT[]>();
  for (const c of cards) {
    const key = `${c.name}|${c.version ?? ""}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const out: LogicalCard[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => printingRank(b) - printingRank(a));
    const canonical = sorted[0]!;
    out.push({
      logicalId: key,
      name: canonical.name,
      version: canonical.version ?? "",
      canonical,
      printings: sorted,
    });
  }
  out.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  return out;
})();

export const logicalCards: readonly LogicalCard[] = _logicalCards;

/** Index logical card by printing id so the deck list can render an
 * image even when it doesn't already know the logical entry. */
export const logicalByPrintingId: ReadonlyMap<string, LogicalCard> = (() => {
  const m = new Map<string, LogicalCard>();
  for (const lc of _logicalCards) {
    for (const p of lc.printings) m.set(p.id, lc);
  }
  return m;
})();

/** Sortable rank: numeric setCodes outrank alphabetic ones; within
 * each, higher setCode then higher cardNumber wins. */
function printingRank(card: CardT): number {
  const numeric = Number.parseInt(card.setCode, 10);
  const setRank = Number.isFinite(numeric)
    ? 1_000_000 + numeric * 10_000
    : 100 * card.setCode.charCodeAt(0);
  return setRank + card.cardNumber;
}
