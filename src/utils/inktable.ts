/**
 * Inktable.net "import deck" URL encoder.
 *
 * Format reverse-engineered from the legacy deck-generator:
 *
 *   id  = btoa("<Name1> - <Version1>$<count1>|<Name2> - <Version2>$<count2>|…")
 *   url = https://inktable.net/lor/import?svc=dreamborn&name=<deckName>&id=<id>
 *
 * Notes:
 * - Cards without a version omit the " - <Version>" suffix.
 * - Multiple printings of the same logical card collapse into a single
 *   entry (their counts add up), because inktable keys by title.
 * - ``btoa`` works on latin1; card titles are ASCII in Lorcana today,
 *   but we run through ``unescape(encodeURIComponent(...))`` for safety
 *   so a future non-ASCII title doesn't break the encoder.
 */

import type { CardT } from "@bjorvack/lorcana-schemas";

const INKTABLE_IMPORT_BASE = "https://inktable.net/lor/import";

export interface DeckExportEntry {
  /** Display title used by inktable (``Name`` or ``Name - Version``). */
  readonly title: string;
  /** Combined count across every printing of this logical card. */
  readonly count: number;
}

/** Collapse printings into one entry per logical title, sorted by title. */
export function buildExportEntries(
  cards: ReadonlyMap<string, number>,
  cardsById: ReadonlyMap<string, CardT>,
): readonly DeckExportEntry[] {
  const byTitle = new Map<string, number>();
  for (const [printingId, count] of cards) {
    const card = cardsById.get(printingId);
    if (!card) continue;
    const title = card.version ? `${card.name} - ${card.version}` : card.name;
    byTitle.set(title, (byTitle.get(title) ?? 0) + count);
  }
  return [...byTitle.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, count]) => ({ title, count }));
}

/** The pre-base64 payload string (``title$count|…``). Exported for tests. */
export function buildInktablePayload(entries: readonly DeckExportEntry[]): string {
  let out = "";
  for (const { title, count } of entries) out += `${title}$${count}|`;
  return out;
}

function utf8Btoa(s: string): string {
  // Defensive for non-ASCII titles. encodeURIComponent → percent-escapes
  // every multi-byte sequence, unescape collapses them back to latin1
  // bytes btoa can swallow. Matches the trick the legacy site uses.
  return btoa(unescape(encodeURIComponent(s)));
}

export function inktableImportUrl(entries: readonly DeckExportEntry[], deckName: string): string {
  const id = utf8Btoa(buildInktablePayload(entries));
  const params = new URLSearchParams({
    svc: "dreamborn",
    name: deckName,
    id,
  });
  return `${INKTABLE_IMPORT_BASE}?${params.toString()}`;
}

/**
 * Plaintext "4 Card Name - Version" form for plain clipboard paste.
 * Most shop-import and Cockatrice-style sites accept this verbatim.
 */
export function buildPlaintextDecklist(entries: readonly DeckExportEntry[]): string {
  return entries.map(({ title, count }) => `${count} ${title}`).join("\n");
}
