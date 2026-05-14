/**
 * Inktable export encoder tests.
 *
 * The encoder is the bridge to a third-party site that we don't own,
 * so the shape of every URL we emit is pinned: a regression here
 * silently breaks every "Open in Inktable" click in the wild.
 */

import { describe, expect, it } from "vitest";

import { cards } from "../src/data/cards";
import type { CardT } from "@bjorvack/lorcana-schemas";

import {
  buildExportEntries,
  buildInktablePayload,
  buildPlaintextDecklist,
  inktableImportUrl,
} from "../src/utils/inktable";

const cardsById = new Map<string, CardT>(cards.map((c) => [c.id, c] as const));

function findCard(name: string, version?: string): CardT {
  const c = cards.find((x) => x.name === name && (!version || x.version === version));
  if (!c) throw new Error(`fixture not found: ${name}${version ? ` - ${version}` : ""}`);
  return c;
}

describe("buildExportEntries", () => {
  it("collapses copies of the same printing", () => {
    const c = findCard("Mickey Mouse", "Brave Little Tailor");
    const entries = buildExportEntries(new Map([[c.id, 4]]), cardsById);
    expect(entries).toEqual([{ title: `${c.name} - ${c.version}`, count: 4 }]);
  });

  it("merges multiple printings of the same logical card", () => {
    // Pick any card that has at least two printings in the pool.
    const printingsByTitle = new Map<string, CardT[]>();
    for (const c of cards) {
      const key = c.version ? `${c.name}|${c.version}` : c.name;
      const list = printingsByTitle.get(key) ?? [];
      list.push(c);
      printingsByTitle.set(key, list);
    }
    const multi = [...printingsByTitle.values()].find((list) => list.length >= 2);
    if (!multi) return; // dataset too sparse to exercise this path
    const [a, b] = multi;
    const entries = buildExportEntries(
      new Map([
        [a!.id, 2],
        [b!.id, 1],
      ]),
      cardsById,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.count).toBe(3);
  });

  it("omits version suffix for cards without a version", () => {
    const noVersion = cards.find((c) => c.version === null);
    if (!noVersion) return;
    const entries = buildExportEntries(new Map([[noVersion.id, 1]]), cardsById);
    expect(entries[0]!.title).toBe(noVersion.name);
  });

  it("ignores unknown card ids without throwing", () => {
    const entries = buildExportEntries(new Map([["crd_does_not_exist", 1]]), cardsById);
    expect(entries).toEqual([]);
  });
});

describe("buildInktablePayload", () => {
  it("emits title$count| segments in order", () => {
    expect(
      buildInktablePayload([
        { title: "A - X", count: 2 },
        { title: "B", count: 4 },
      ]),
    ).toBe("A - X$2|B$4|");
  });
});

describe("inktableImportUrl", () => {
  it("produces a dreamborn import URL with base64 id", () => {
    const url = inktableImportUrl(
      [{ title: "Mickey - Brave Little Tailor", count: 4 }],
      "Test deck",
    );
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://inktable.net/lor/import");
    expect(u.searchParams.get("svc")).toBe("dreamborn");
    expect(u.searchParams.get("name")).toBe("Test deck");
    const id = u.searchParams.get("id")!;
    // round-trip the base64 id back to the payload form to verify
    // we're emitting the legacy schema verbatim.
    expect(atob(id)).toBe("Mickey - Brave Little Tailor$4|");
  });
});

describe("buildPlaintextDecklist", () => {
  it("emits one line per entry with count first", () => {
    expect(
      buildPlaintextDecklist([
        { title: "A - X", count: 2 },
        { title: "B", count: 4 },
      ]),
    ).toBe("2 A - X\n4 B");
  });
});
