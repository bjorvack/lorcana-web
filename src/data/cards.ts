/**
 * Pinned card pool. ``cards.json`` is produced at build time by the
 * fetch-cards Vite plugin (see ``build/fetch-cards.ts``); it never
 * exists in the repo at rest, only in the build output and on dev
 * runs after the plugin has executed.
 *
 * Re-exported here as a typed ``CardSetT`` + a ``Map<id, Card>``
 * lookup so callsites never reach into the raw JSON.
 */

import { CardSet, type CardSetT, type CardT } from "@bjorvack/lorcana-schemas";

import raw from "./cards.json";

export const cardSet: CardSetT = CardSet.parse(raw);
export const cards: readonly CardT[] = cardSet.cards;
export const cardsById: ReadonlyMap<string, CardT> = new Map(cards.map((c) => [c.id, c]));

export { CARDS_RELEASE_TAG, CARD_SET_VERSION, CARDS_JSON_SHA256, CARD_COUNT } from "./cards.meta";
