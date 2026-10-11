/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { computeCollectionStation, unknownMemberOrdinal, type CollectionPool } from "@/lib/sidRadio/collectionEngine";
import { parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import { computeStation } from "@/lib/sidRadio/stationEngine";
import { computeStationResponse } from "@/lib/sidRadio/sidRadioWorkerCore";
import { buildTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

// Ordinals 0–7 are one-tune files in a chain (n → n-1); file 8 holds three tunes at ordinals 8–10.
const MD5 = [
  "aaaaaaaaaaaa",
  "bbbbbbbbbbbb",
  "cccccccccccc",
  "dddddddddddd",
  "eeeeeeeeeeee",
  "ffffffffffff",
  "111111111111",
  "222222222222",
  "333333333333",
];
const UNKNOWN = "999999999999";

const bundle: SidcorrTinyBundle = parseSidcorrTiny(
  buildTinyFixture({
    files: [
      { md5_48: MD5[0], tracks: [{}] },
      { md5_48: MD5[1], tracks: [{ neighbors: [0] }] },
      { md5_48: MD5[2], tracks: [{ neighbors: [1] }] },
      { md5_48: MD5[3], tracks: [{ neighbors: [2] }] },
      { md5_48: MD5[4], tracks: [{ neighbors: [3] }] },
      { md5_48: MD5[5], tracks: [{ neighbors: [4] }] },
      { md5_48: MD5[6], tracks: [{ neighbors: [5] }] },
      { md5_48: MD5[7], tracks: [{ neighbors: [6] }] },
      { md5_48: MD5[8], tracks: [{}, {}, {}] },
    ],
  }),
);

/** Members: ordinals 1, 3, 5, 7, tunes 1 and 3 of file 8, and a tune the bundle does not know. */
const POOL: CollectionPool = {
  md5_48: [MD5[1], MD5[3], MD5[5], MD5[7], MD5[8], MD5[8], UNKNOWN],
  songNr: [1, 1, 1, 1, 1, 3, 1],
};
const UNKNOWN_ORDINAL = unknownMemberOrdinal(bundle.trackCount, UNKNOWN, 1);
const MEMBER_ORDINALS = [1, 3, 5, 7, 8, 10, UNKNOWN_ORDINAL];

const orderFor = (options: Partial<Parameters<typeof computeCollectionStation>[0]> = {}) =>
  computeCollectionStation({ bundle, pool: POOL, shuffleSeed: 1, ...options }).candidates.map(
    (candidate) => candidate.trackOrdinal,
  );

/** Where a member lands on average over many shuffles; lower means earlier. */
const meanPosition = (ordinal: number, options: Partial<Parameters<typeof computeCollectionStation>[0]> = {}) => {
  let total = 0;
  const runs = 400;
  for (let shuffleSeed = 1; shuffleSeed <= runs; shuffleSeed += 1) {
    total += orderFor({ ...options, shuffleSeed }).indexOf(ordinal);
  }
  return total / runs;
};

describe("computeCollectionStation", () => {
  it("emits the members and nothing else", () => {
    expect(orderFor().sort((a, b) => a - b)).toEqual(MEMBER_ORDINALS);
  });

  it("plays every member exactly once, then reports the collection finished", () => {
    const played: number[] = [];
    for (;;) {
      const result = computeCollectionStation({ bundle, pool: POOL, shuffleSeed: 9, exclude: played, limit: 2 });
      if (result.candidates.length === 0) {
        expect(result.empty).toBe("exhausted");
        break;
      }
      played.push(...result.candidates.map((candidate) => candidate.trackOrdinal));
    }
    expect([...played].sort((a, b) => a - b)).toEqual(MEMBER_ORDINALS);
  });

  it("keeps two tunes of one file as separate members instead of retiring the second", () => {
    const fileTunes = computeCollectionStation({ bundle, pool: POOL, shuffleSeed: 1 }).candidates.filter(
      (candidate) => candidate.md5_48 === MD5[8],
    );
    expect(fileTunes.map((candidate) => [candidate.songNr, candidate.fileTrackOrdinals])).toEqual(
      expect.arrayContaining([
        [1, [8]],
        [3, [10]],
      ]),
    );
  });

  it("plays a member the similarity bundle does not know, under an ordinal past the bundle", () => {
    const unknown = computeCollectionStation({ bundle, pool: POOL, shuffleSeed: 1 }).candidates.find(
      (candidate) => candidate.md5_48 === UNKNOWN,
    );
    expect(unknown).toMatchObject({ trackOrdinal: UNKNOWN_ORDINAL, songNr: 1, reason: "collection" });
  });

  it("plays a tune number the bundle has no track for rather than dropping it", () => {
    const pool = { md5_48: [MD5[1]], songNr: [4] };
    expect(computeCollectionStation({ bundle, pool, shuffleSeed: 1 }).candidates).toMatchObject([
      { trackOrdinal: unknownMemberOrdinal(bundle.trackCount, MD5[1], 4), songNr: 4 },
    ]);
  });

  it("keeps the ordinal of a member the bundle does not know when other members join or leave the pool", () => {
    const ordinalOf = (pool: CollectionPool, md5_48: string) =>
      computeCollectionStation({ bundle, pool, shuffleSeed: 1 }).candidates.find(
        (candidate) => candidate.md5_48 === md5_48,
      )?.trackOrdinal;
    const grown: CollectionPool = {
      md5_48: ["888888888888", MD5[0], ...POOL.md5_48],
      songNr: [2, 1, ...POOL.songNr],
    };
    const shrunk: CollectionPool = { md5_48: [UNKNOWN], songNr: [1] };
    expect(ordinalOf(grown, UNKNOWN)).toBe(ordinalOf(POOL, UNKNOWN));
    expect(ordinalOf(shrunk, UNKNOWN)).toBe(ordinalOf(POOL, UNKNOWN));
    expect(ordinalOf(POOL, UNKNOWN)).toBeGreaterThanOrEqual(bundle.trackCount);
  });

  it("gives two unknown members whose identities hash alike distinct ordinals, in identity order", () => {
    // Found by search: these two identities hash to the same ordinal.
    const [lower, higher] = ["000000018d5c", "000000028a28"];
    expect(unknownMemberOrdinal(bundle.trackCount, lower, 1)).toBe(unknownMemberOrdinal(bundle.trackCount, higher, 1));
    const ordinalsFor = (md5_48: string[]) =>
      Object.fromEntries(
        computeCollectionStation({
          bundle,
          pool: { md5_48, songNr: md5_48.map(() => 1) },
          shuffleSeed: 1,
        }).candidates.map((candidate) => [candidate.md5_48, candidate.trackOrdinal]),
      );
    const base = unknownMemberOrdinal(bundle.trackCount, lower, 1);
    expect(ordinalsFor([higher, lower])).toEqual({ [lower]: base, [higher]: base + 1 });
    expect(ordinalsFor([lower, higher])).toEqual({ [lower]: base, [higher]: base + 1 });
  });

  it("never offers a tune marked Not for me", () => {
    for (let shuffleSeed = 1; shuffleSeed < 50; shuffleSeed += 1) {
      expect(orderFor({ shuffleSeed, notForMe: [`${MD5[5]}${"0".repeat(20)}`] })).not.toContain(5);
    }
  });

  it("brings a liked member forward", () => {
    expect(meanPosition(7, { likes: [MD5[7]] })).toBeLessThan(meanPosition(7) - 1);
  });

  it("brings a member forward when the listener liked a tune it sounds like", () => {
    // 4 is not a member, but its edge to 3 makes 3 its neighbour.
    expect(meanPosition(3, { likes: [MD5[4]] })).toBeLessThan(meanPosition(3) - 0.5);
  });

  it("pushes back a member that sounds like a rejected tune", () => {
    expect(meanPosition(3, { notForMe: [MD5[4]] })).toBeGreaterThan(meanPosition(3) + 0.5);
  });

  it("gives the same order for the same shuffle seed, and a different one for another", () => {
    expect(orderFor({ shuffleSeed: 5 })).toEqual(orderFor({ shuffleSeed: 5 }));
    const orders = new Set(Array.from({ length: 10 }, (_, index) => orderFor({ shuffleSeed: index + 1 }).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("lists a member once when the pool names it twice", () => {
    const pool = { md5_48: [MD5[1], MD5[1]], songNr: [1, 1] };
    expect(computeCollectionStation({ bundle, pool, shuffleSeed: 1 }).candidates).toHaveLength(1);
  });

  it("caps a batch at the limit", () => {
    expect(orderFor({ limit: 3 })).toHaveLength(3);
  });

  it("reports an empty pool as having nothing to play", () => {
    expect(computeCollectionStation({ bundle, pool: { md5_48: [], songNr: [] }, shuffleSeed: 1 })).toEqual({
      candidates: [],
      empty: "no-neighbours",
    });
  });
});

describe("collection stations through the worker", () => {
  const request = {
    seed: { kind: "collection" as const, collectionId: "winners" },
    shuffleSeed: 1,
    likes: [],
    notForMe: [],
    exclude: [],
    recent: [],
    count: 50,
  };

  it("computes a collection request from its pool", () => {
    const response = computeStationResponse(bundle, 7, { ...request, pool: POOL });
    expect(response.type).toBe("candidates");
    if (response.type !== "candidates") return;
    expect(response.id).toBe(7);
    expect(response.candidates.map((candidate) => candidate.trackOrdinal).sort((a, b) => a - b)).toEqual(
      MEMBER_ORDINALS,
    );
  });

  it("answers a collection request without a pool as empty", () => {
    expect(computeStationResponse(bundle, 8, request)).toEqual({ type: "empty", id: 8, reason: "no-neighbours" });
  });

  it("refuses to run a collection through the similarity walk", () => {
    expect(() =>
      computeStation({ bundle, seed: { kind: "collection", collectionId: "winners" }, shuffleSeed: 1 }),
    ).toThrow(/computeCollectionStation/);
  });
});
