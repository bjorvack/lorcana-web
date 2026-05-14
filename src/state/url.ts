/**
 * Hash-param serialisation for shareable deck URLs.
 *
 * The URL hash carries:
 *
 *   #inks=amber-steel
 *   #deck=<base64url-encoded card-id multiset>
 *   #locks=<base64url-encoded card-id set>
 *
 * Encoding choices:
 *
 * - Hash, not query string. Avoids server round-trips and keeps GitHub
 *   Pages happy with deep links — every path resolves to ``index.html``.
 * - **base64url** (RFC 4648 §5) not standard base64. ``+`` and ``/``
 *   need percent-encoding in URLs; the URL-safe alphabet sidesteps
 *   that and the result is shorter.
 * - Deck payload is the *uncompressed* comma-separated text
 *   ``id:count,id:count,...``. We rely on the host's `cards-vN`
 *   pin to keep the id space stable; if the consumer is on a newer
 *   ``cards-vN`` that doesn't have an id, the load step warns
 *   per slot rather than failing the whole URL parse.
 *
 * Round-trip property: ``parse(serialize(x)) === x`` for all
 * well-formed states. ``parse`` is forgiving — any malformed hash
 * is treated as "no state encoded" so a broken URL never bricks
 * the app.
 */

import { type InkT, InkValues } from "@bjorvack/lorcana-schemas";

import { defaultFormat, type Format } from "../data/legality";
import type { DeckState } from "./deck";
import { emptyDeck } from "./deck";

// Short tokens in the URL are nicer than the verbose enum literals.
const FORMAT_TO_TOKEN: Record<Format, string> = {
  core_constructed: "core",
  infinity_constructed: "infinity",
};
const TOKEN_TO_FORMAT: Record<string, Format> = {
  core: "core_constructed",
  infinity: "infinity_constructed",
};

const INK_BY_KEBAB = new Map<string, InkT>(InkValues.map((i) => [i.toLowerCase(), i]));

export interface SerialisedDeck {
  readonly inks?: string;
  readonly deck?: string;
  readonly locks?: string;
  readonly format?: string;
}

// --- public API -------------------------------------------------

export function serialiseDeck(state: DeckState): SerialisedDeck {
  const inks = state.inks.map((i) => i.toLowerCase()).join("-");
  const deckEntries: string[] = [];
  for (const [id, count] of state.cards) deckEntries.push(`${id}:${count}`);
  const deck = deckEntries.length > 0 ? encodeBase64Url(deckEntries.join(",")) : undefined;
  const locks = state.locks.size > 0 ? encodeBase64Url([...state.locks].join(",")) : undefined;
  // Only emit ``format`` when it differs from the boot-time default
  // so plain links stay short; defaultFormat is stable across loads
  // for the same calendar day.
  const fmtToken = FORMAT_TO_TOKEN[state.format];
  const format = fmtToken !== FORMAT_TO_TOKEN[defaultFormat()] ? fmtToken : undefined;
  return {
    inks,
    ...(deck !== undefined ? { deck } : {}),
    ...(locks !== undefined ? { locks } : {}),
    ...(format !== undefined ? { format } : {}),
  };
}

export function buildHash(state: DeckState): string {
  const s = serialiseDeck(state);
  const params = new URLSearchParams();
  if (s.inks) params.set("inks", s.inks);
  if (s.deck) params.set("deck", s.deck);
  if (s.locks) params.set("locks", s.locks);
  if (s.format) params.set("format", s.format);
  const str = params.toString();
  return str ? `#${str}` : "";
}

export function parseHash(hash: string): SerialisedDeck {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const inks = params.get("inks") ?? undefined;
  const deck = params.get("deck") ?? undefined;
  const locks = params.get("locks") ?? undefined;
  const format = params.get("format") ?? undefined;
  return {
    ...(inks ? { inks } : {}),
    ...(deck ? { deck } : {}),
    ...(locks ? { locks } : {}),
    ...(format ? { format } : {}),
  };
}

export function applyHash(hash: string): { state: DeckState; warnings: readonly string[] } {
  // Forgiving load: a malformed or partial hash leaves the unaffected
  // pieces at their defaults rather than throwing.
  const parsed = parseHash(hash);
  const warnings: string[] = [];

  let inks: InkT[] = ["Amber", "Steel"];
  if (parsed.inks) {
    const parsedInks = parsed.inks
      .split("-")
      .map((p) => INK_BY_KEBAB.get(p.toLowerCase()))
      .filter((i): i is InkT => i !== undefined);
    if (parsedInks.length === 1 || parsedInks.length === 2) inks = parsedInks;
    else warnings.push(`Could not parse inks="${parsed.inks}"; using default`);
  }

  const cards = new Map<string, number>();
  if (parsed.deck) {
    const decoded = safeDecodeBase64Url(parsed.deck);
    if (decoded === null) warnings.push("Could not decode the deck payload; ignoring");
    else {
      for (const entry of decoded.split(",")) {
        const colon = entry.lastIndexOf(":");
        if (colon < 0) continue;
        const id = entry.slice(0, colon);
        const count = Number.parseInt(entry.slice(colon + 1), 10);
        if (!id || !Number.isFinite(count) || count <= 0) continue;
        cards.set(id, count);
      }
    }
  }

  const locks = new Set<string>();
  if (parsed.locks) {
    const decoded = safeDecodeBase64Url(parsed.locks);
    if (decoded === null) warnings.push("Could not decode the locks payload; ignoring");
    else for (const id of decoded.split(",")) if (id) locks.add(id);
  }

  let format: Format = defaultFormat();
  if (parsed.format) {
    const mapped = TOKEN_TO_FORMAT[parsed.format.toLowerCase()];
    if (mapped) format = mapped;
    else warnings.push(`Unknown format="${parsed.format}"; using default`);
  }

  return { state: { ...emptyDeck(inks, format), cards, locks }, warnings };
}

// --- base64url --------------------------------------------------

function encodeBase64Url(s: string): string {
  // btoa works on latin1; encode as UTF-8 first for safety even
  // though card ids are ASCII.
  const utf8 = unescape(encodeURIComponent(s));
  return btoa(utf8).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function safeDecodeBase64Url(s: string): string | null {
  try {
    const padded = s.replaceAll("-", "+").replaceAll("_", "/");
    // Re-pad to a multiple of 4.
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const utf8 = atob(padded + pad);
    return decodeURIComponent(escape(utf8));
  } catch {
    return null;
  }
}
