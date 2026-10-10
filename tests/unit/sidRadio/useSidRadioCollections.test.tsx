/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionPool } from "@/lib/sidRadio/collectionEngine";
import type { StilCollectionIndex } from "@/lib/hvsc/stilCollections";
import type { StationRequest } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import type { StationResult } from "@/lib/sidRadio/stationEngine";

const pools = vi.hoisted(() => ({ loadCollectionPool: vi.fn<(id: string) => Promise<CollectionPool | null>>() }));
vi.mock("@/lib/sidRadio/collectionPool", () => pools);
const stil = vi.hoisted(() => ({ readStilCollections: vi.fn<() => Promise<StilCollectionIndex | null>>() }));
vi.mock("@/lib/hvsc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hvsc")>()),
  readStilCollections: stil.readStilCollections,
}));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { toast } from "@/hooks/use-toast";
import { clearAllRankings } from "@/lib/sidRadio/rankingStore";
import { rebuildMd548PathIndex, resetMd548PathIndex } from "@/lib/sidRadio/md5PathIndex";
import { loadSidRadioSession, saveSidRadioSession } from "@/lib/sidRadio/sidRadioSession";
import { useSidRadio } from "@/pages/playFiles/hooks/useSidRadio";

const POOL: CollectionPool = { md5_48: ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"], songNr: [1, 2, 1] };

/** A worker that plays the pool it is handed, in order, and nothing else. */
const makeClient = () => ({
  load: vi.fn().mockResolvedValue({ fileCount: 3, trackCount: 3, stylePopulations: {}, engineThreadIsMain: false }),
  compute: vi.fn(async (request: StationRequest): Promise<StationResult> => {
    const members = (request.pool?.md5_48 ?? []).map((md5_48, index) => ({ md5_48, ordinal: index }));
    const open = members.filter((member) => !request.exclude.includes(member.ordinal));
    if (open.length === 0) return { candidates: [], empty: "exhausted" };
    return {
      candidates: open.slice(0, request.count).map((member) => ({
        trackOrdinal: member.ordinal,
        md5_48: member.md5_48,
        songNr: request.pool!.songNr[member.ordinal],
        score: 1,
        reason: "collection" as const,
        fileTrackOrdinals: [member.ordinal],
      })),
    };
  }),
  terminate: vi.fn(),
});

type Params = Parameters<typeof useSidRadio>[0];
const paramsFor = (client: ReturnType<typeof makeClient>, overrides: Partial<Params> = {}): Params => ({
  enabled: true,
  startPlaylist: vi.fn(),
  appendItems: vi.fn(),
  currentIndex: 0,
  playlistLength: 3,
  clientFactory: () => client as never,
  resolvePath: (md5: string) => `/HVSC/${md5}.sid`,
  randomSeed: () => 4242,
  ...overrides,
});

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
  resetMd548PathIndex();
  rebuildMd548PathIndex(";/MUSICIANS/A/A.sid\naaaaaaaaaaaa00000000000000000000=3:00\n", { force: true });
  pools.loadCollectionPool.mockReset();
  pools.loadCollectionPool.mockResolvedValue(POOL);
  stil.readStilCollections.mockReset();
  vi.mocked(toast).mockClear();
});

describe("useSidRadio collection stations", () => {
  it("hands the collection's members to the worker and plays them", async () => {
    const client = makeClient();
    const params = paramsFor(client);
    const { result } = renderHook(() => useSidRadio(params));

    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });

    expect(pools.loadCollectionPool).toHaveBeenCalledWith("winners");
    expect(client.compute.mock.calls[0][0]).toMatchObject({
      seed: { kind: "collection", collectionId: "winners" },
      pool: POOL,
    });
    const items = vi.mocked(params.startPlaylist).mock.calls[0][0];
    expect(items.map((item) => [item.path, item.request.songNr])).toEqual([
      ["/HVSC/aaaaaaaaaaaa.sid", 1],
      ["/HVSC/bbbbbbbbbbbb.sid", 2],
      ["/HVSC/cccccccccccc.sid", 1],
    ]);
    expect(result.current.station).toMatchObject({ seedKind: "collection", seedLabel: "Competition winners" });
    expect(loadSidRadioSession()?.seed).toEqual({ kind: "collection", collectionId: "winners" });
  });

  it("counts how far through its members the station is", async () => {
    const client = makeClient();
    const { result, rerender } = renderHook((props: Params) => useSidRadio(props), {
      initialProps: paramsFor(client),
    });
    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });
    rerender(paramsFor(client, { currentIndex: 0, playlistLength: 3 }));
    expect(result.current.collectionProgress).toEqual({ heard: 1, total: 3 });
    rerender(paramsFor(client, { currentIndex: 2, playlistLength: 3 }));
    expect(result.current.collectionProgress).toEqual({ heard: 3, total: 3 });
  });

  it("reports no progress for a station that is not a collection", async () => {
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    expect(result.current.collectionProgress).toBeNull();
  });

  it("refuses the station, and says why, when the tune notes cannot be loaded", async () => {
    pools.loadCollectionPool.mockResolvedValue(null);
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.startCollectionRadio("classical");
    });
    expect(result.current.station).toBeNull();
    expect(result.current.notice).toBe("no-radio-for-collection");
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("says the collection is finished, not merely ended, when every member has been played", async () => {
    const client = makeClient();
    const params = paramsFor(client);
    const { result, rerender } = renderHook((props: Params) => useSidRadio(props), { initialProps: params });
    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });
    await act(async () => {
      rerender({ ...params, currentIndex: 2, playlistLength: 3 });
    });
    await waitFor(() => expect(result.current.notice).toBe("collection-ended"));
  });

  it("resumes a saved collection and loads its members on the first refill", async () => {
    saveSidRadioSession({
      seedKind: "collection",
      seedLabel: "Classical",
      seed: { kind: "collection", collectionId: "classical" },
      styleFilter: null,
      shuffleSeed: 99,
      rankingSnapshotId: "snap",
      excludeOrdinals: [0],
    });
    const client = makeClient();
    const params = paramsFor(client, { currentIndex: 0, playlistLength: 1 });
    const { result } = renderHook(() => useSidRadio(params));

    expect(result.current.station).toMatchObject({ seedKind: "collection", seedLabel: "Classical" });
    await waitFor(() => expect(params.appendItems).toHaveBeenCalled());
    expect(pools.loadCollectionPool).toHaveBeenCalledWith("classical");
    expect(client.compute.mock.calls[0][0]).toMatchObject({ exclude: [0], pool: POOL });
  });

  it("says the collection cannot play, rather than that it finished, for a saved id this build does not know", async () => {
    saveSidRadioSession({
      seedKind: "collection",
      seedLabel: "Jazz",
      seed: { kind: "collection", collectionId: "jazz" },
      styleFilter: null,
      shuffleSeed: 99,
      rankingSnapshotId: "snap",
      excludeOrdinals: [],
    });
    const client = makeClient();
    const { result } = renderHook(() => useSidRadio(paramsFor(client, { currentIndex: 0, playlistLength: 1 })));
    await waitFor(() => expect(result.current.notice).toBe("no-radio-for-collection"));
    expect(pools.loadCollectionPool).not.toHaveBeenCalled();
    expect(client.compute).not.toHaveBeenCalled();
  });
});

describe("useSidRadio collection counts", () => {
  const index = (winners: number): StilCollectionIndex =>
    ({
      version: 1,
      paths: ["/A.sid"],
      collections: { winners: Array.from({ length: winners }, () => [0, 1]), classical: [] },
    }) as unknown as StilCollectionIndex;

  it("reads the members per collection for the launcher", async () => {
    stil.readStilCollections.mockResolvedValue(index(2));
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toEqual({ winners: 2, classical: 0 });
  });

  it("keeps the same counts object when nothing changed, so the launcher does not re-render for nothing", async () => {
    stil.readStilCollections.mockResolvedValue(index(2));
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    const first = result.current.collectionCounts;
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toBe(first);
    stil.readStilCollections.mockResolvedValue(index(3));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toEqual({ winners: 3, classical: 0 });
  });

  it("leaves the counts unknown while STIL is not stored", async () => {
    stil.readStilCollections.mockResolvedValue(null);
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toBeNull();
  });

  it("reads nothing while SID Radio is off", async () => {
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient(), { enabled: false })));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(stil.readStilCollections).not.toHaveBeenCalled();
  });
});
