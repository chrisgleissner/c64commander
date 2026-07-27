/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import type { StationCandidate, StationResult } from "@/lib/sidRadio/stationEngine";

const candidate = (trackOrdinal: number): StationCandidate => ({
  trackOrdinal,
  md5_48: `md${trackOrdinal.toString().padStart(10, "0")}`,
  songIndex: 1,
  score: 100 - trackOrdinal,
  reason: "similar",
});

/** A scripted engine: returns the ordinals in `order`, respecting the exclude set. */
const scriptedEngine = (order: number[]) => {
  return async (excludeOrdinals: number[], count: number): Promise<StationResult> => {
    const excluded = new Set(excludeOrdinals);
    const candidates = order
      .filter((o) => !excluded.has(o))
      .slice(0, count)
      .map(candidate);
    return { candidates, empty: candidates.length === 0 ? "exhausted" : undefined };
  };
};

const buildItem = ({ virtualPath, trackOrdinal }: { virtualPath: string; trackOrdinal: number }) =>
  ({
    id: `it:${trackOrdinal}`,
    request: { source: "hvsc", path: virtualPath },
    category: "sid",
    label: virtualPath,
    path: virtualPath,
  }) as never;

describe("StationQueueProvider", () => {
  it("resolves the next `count` items and advances the exclude set", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1, 2, 3, 4, 5]),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
    });
    const first = await provider.refill(2);
    expect(first.items).toHaveLength(2);
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1]);
    const second = await provider.refill(2);
    expect(second.items).toHaveLength(2);
    // No double-append: the second batch is different ordinals.
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("skips a candidate whose md5_48 no longer resolves (removed tune, §2.5)", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1, 2, 3]),
      // ordinal 1 and 2 are unresolved (removed by an HVSC update).
      resolvePath: (md5) => (md5 === candidate(1).md5_48 || md5 === candidate(2).md5_48 ? null : `/x/${md5}.sid`),
      buildItem,
    });
    const result = await provider.refill(2);
    // Emits 0 and 3 (skipping 1, 2) — no gap.
    expect(result.items).toHaveLength(2);
    // 1 and 2 were consumed (excluded) even though skipped.
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("keeps ~lookahead items queued by default", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine(Array.from({ length: 40 }, (_, i) => i)),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
      lookahead: 10,
    });
    const result = await provider.refill();
    expect(result.items).toHaveLength(10);
  });

  it("reports 'exhausted' when the engine runs out", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1]),
      resolvePath: () => null, // nothing resolves
      buildItem,
    });
    const result = await provider.refill(5);
    expect(result.items).toHaveLength(0);
    expect(result.reason).toBe("exhausted");
  });

  it("surfaces a 'no-neighbours' empty from the engine", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: async () => ({ candidates: [], empty: "no-neighbours" }),
      resolvePath: () => "/x.sid",
      buildItem,
    });
    const result = await provider.refill(3);
    expect(result.items).toEqual([]);
    expect(result.reason).toBe("no-neighbours");
  });

  it("honours an initial exclude set (resume)", async () => {
    const provider = new StationQueueProvider({
      computeCandidates: scriptedEngine([0, 1, 2, 3]),
      resolvePath: (md5) => `/x/${md5}.sid`,
      buildItem,
      initialExclude: [0, 1],
    });
    const result = await provider.refill(2);
    expect(result.items).toHaveLength(2);
    expect(provider.excludedOrdinals.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
});
