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
  ensureStilReady: vi.fn(async (_options?: { retryNow?: boolean }) => true),
  isStilFetchNeeded: vi.fn(async () => false),
  stilUnavailableReason: vi.fn(() => "not-downloaded" as const),
  readStilCollections: vi.fn<() => Promise<StilCollectionIndex | null>>(),
}));
vi.mock("@/lib/hvsc", async () => {
  const collections = await import("@/lib/hvsc/stilCollections");
  return {
    ...hvsc,
    STIL_COLLECTION_IDS: collections.STIL_COLLECTION_IDS,
    stilCollectionCounts: collections.stilCollectionCounts,
  };
});
const logs = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/logging", () => logs);

import {
  __resetCollectionPoolCacheForTest,
  loadCollectionPool,
  loadCollectionSizes,
  prepareCollectionNotes,
} from "@/lib/sidRadio/collectionPool";
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
    hvsc.isStilFetchNeeded.mockReset();
    hvsc.isStilFetchNeeded.mockResolvedValue(false);
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

  it("never downloads STIL, because a station asks for its members on every refill", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    await loadCollectionPool("winners");
    await loadCollectionPool("winners");
    expect(hvsc.ensureStilReady).not.toHaveBeenCalled();
  });

  it("counts a duplicate file once, because it is the same tune", async () => {
    rebuildMd548PathIndex(`${SONGLENGTHS}; /MUSICIANS/D/Copy_of_Winner.sid\naaaaaaaaaaaa00000000000000000000=3:00\n`, {
      force: true,
    });
    hvsc.readStilCollections.mockResolvedValue({
      ...index(),
      paths: ["/MUSICIANS/A/Winner.sid", "/MUSICIANS/D/Copy_of_Winner.sid"],
      collections: {
        winners: [
          [0, 1],
          [1, 1],
        ],
      },
    } as unknown as StilCollectionIndex);
    expect(await loadCollectionPool("winners")).toEqual({ md5_48: ["aaaaaaaaaaaa"], songNr: [1] });
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

describe("loadCollectionSizes", () => {
  beforeEach(() => {
    __resetCollectionPoolCacheForTest();
    resetMd548PathIndex();
    hvsc.readStilCollections.mockReset();
  });

  it("counts the tunes a station can play, which is what the station counts to", async () => {
    rebuildMd548PathIndex(SONGLENGTHS, { force: true });
    hvsc.readStilCollections.mockResolvedValue(index());
    const sizes = await loadCollectionSizes();
    expect(sizes).toMatchObject({ winners: 1, classical: 1, christmas: 0 });
    expect(sizes?.winners).toBe((await loadCollectionPool("winners"))?.md5_48.length);
  });

  it("counts what STIL lists until the library's songlengths have been read", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    expect(await loadCollectionSizes()).toMatchObject({ winners: 2, classical: 1 });
  });

  it("answers null while STIL is not stored", async () => {
    hvsc.readStilCollections.mockResolvedValue(null);
    expect(await loadCollectionSizes()).toBeNull();
  });
});

describe("prepareCollectionNotes", () => {
  beforeEach(() => {
    hvsc.ensureStilReady.mockClear();
    hvsc.isStilFetchNeeded.mockReset();
    hvsc.readStilCollections.mockReset();
    hvsc.stilUnavailableReason.mockReset();
  });

  it("downloads once, as the listener's own request, and says so first when a download is needed", async () => {
    hvsc.isStilFetchNeeded.mockResolvedValue(true);
    hvsc.readStilCollections.mockResolvedValue(index());
    const onFetching = vi.fn();
    expect(await prepareCollectionNotes(onFetching)).toBe("ready");
    expect(onFetching).toHaveBeenCalledTimes(1);
    expect(onFetching.mock.invocationCallOrder[0]).toBeLessThan(hvsc.ensureStilReady.mock.invocationCallOrder[0]);
    expect(hvsc.ensureStilReady).toHaveBeenCalledTimes(1);
    expect(hvsc.ensureStilReady).toHaveBeenCalledWith({ retryNow: true });
  });

  it("shows no wait when the notes are already on disk", async () => {
    hvsc.readStilCollections.mockResolvedValue(index());
    const onFetching = vi.fn();
    expect(await prepareCollectionNotes(onFetching)).toBe("ready");
    expect(onFetching).not.toHaveBeenCalled();
  });

  it.each(["no-library", "demo-library", "not-downloaded"] as const)(
    "reports %s when no collections can be read afterwards",
    async (reason) => {
      hvsc.readStilCollections.mockResolvedValue(null);
      hvsc.stilUnavailableReason.mockReturnValue(reason as never);
      expect(await prepareCollectionNotes(vi.fn())).toBe(reason);
    },
  );
});
