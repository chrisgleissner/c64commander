/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StilCollectionIndex } from "@/lib/hvsc/stilCollections";

const hvsc = vi.hoisted(() => ({
  ensureStilReady: vi.fn(async () => true),
  readStilCollections: vi.fn<() => Promise<StilCollectionIndex | null>>(),
}));
vi.mock("@/lib/hvsc", () => hvsc);
const logs = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/logging", () => logs);

import { __resetCollectionPoolCacheForTest, loadCollectionPool } from "@/lib/sidRadio/collectionPool";
import { rebuildMd548PathIndex, resetMd548PathIndex } from "@/lib/sidRadio/md5PathIndex";

const SONGLENGTHS = `[Database]
; /MUSICIANS/A/Winner.sid
aaaaaaaaaaaa00000000000000000000=3:00
; /MUSICIANS/B/Classic.sid
bbbbbbbbbbbb00000000000000000000=2:00 1:00 4:00
`;

const index = (): StilCollectionIndex =>
  ({
    version: 1,
    paths: ["/MUSICIANS/A/Winner.sid", "/MUSICIANS/B/Classic.sid", "/MUSICIANS/C/NotInstalled.sid"],
    collections: {
      winners: [
        [0, 1],
        [2, 1],
      ],
      classical: [[1, 3]],
    },
  }) as unknown as StilCollectionIndex;

describe("loadCollectionPool", () => {
  beforeEach(() => {
    __resetCollectionPoolCacheForTest();
    resetMd548PathIndex();
    rebuildMd548PathIndex(SONGLENGTHS, { force: true });
    hvsc.ensureStilReady.mockClear();
    hvsc.readStilCollections.mockReset();
    logs.addLog.mockClear();
  });

  it("turns STIL paths into the identities the engine plays, keeping the tune number", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    expect(await loadCollectionPool("classical")).toEqual({ md5_48: ["bbbbbbbbbbbb"], songNr: [3] });
  });

  it("leaves out a member whose file is not installed", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    expect(await loadCollectionPool("winners")).toEqual({ md5_48: ["aaaaaaaaaaaa"], songNr: [1] });
  });

  it("makes sure STIL is on disk before reading the collections", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    await loadCollectionPool("winners");
    expect(hvsc.ensureStilReady).toHaveBeenCalledTimes(1);
    expect(hvsc.ensureStilReady.mock.invocationCallOrder[0]).toBeLessThan(
      hvsc.readStilCollections.mock.invocationCallOrder[0],
    );
  });

  it("answers null, and logs why, when STIL is not available", async () => {
    hvsc.readStilCollections.mockResolvedValue(null);
    expect(await loadCollectionPool("winners")).toBeNull();
    expect(logs.addLog).toHaveBeenCalledWith("warn", "SID Radio: STIL collections are not available", {
      service: "sid-radio",
      collection: "winners",
    });
  });

  it("reuses the pool while neither STIL nor the installed library changed", async () => {
    const stored = index();
    hvsc.readStilCollections.mockResolvedValue(stored);
    const first = await loadCollectionPool("winners");
    expect(await loadCollectionPool("winners")).toBe(first);
  });

  it("builds the pool again once the installed library changes", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    const first = await loadCollectionPool("winners");
    rebuildMd548PathIndex(`${SONGLENGTHS}; /MUSICIANS/C/NotInstalled.sid\ncccccccccccc00000000000000000000=1:00\n`, {
      force: true,
    });
    const second = await loadCollectionPool("winners");
    expect(second).not.toBe(first);
    expect(second?.md5_48).toEqual(["aaaaaaaaaaaa", "cccccccccccc"]);
  });

  it("answers an empty pool for a collection the index does not hold", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    expect(await loadCollectionPool("christmas")).toEqual({ md5_48: [], songNr: [] });
  });
});
