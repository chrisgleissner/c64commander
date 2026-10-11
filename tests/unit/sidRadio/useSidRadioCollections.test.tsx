/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionNotesStatus } from "@/lib/sidRadio/collectionPool";
import type { CollectionPool } from "@/lib/sidRadio/collectionEngine";
import type { StilCollectionId } from "@/lib/hvsc/stilCollections";
import type { StationRequest } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import type { StationResult } from "@/lib/sidRadio/stationEngine";

const pools = vi.hoisted(() => ({
  loadCollectionPool: vi.fn<(id: string) => Promise<CollectionPool | null>>(),
  loadCollectionSizes: vi.fn<() => Promise<Record<StilCollectionId, number> | null>>(),
  prepareCollectionNotes: vi.fn<(onFetching: () => void) => Promise<CollectionNotesStatus>>(),
}));
vi.mock("@/lib/sidRadio/collectionPool", () => pools);
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
  pools.loadCollectionSizes.mockReset();
  pools.prepareCollectionNotes.mockReset();
  pools.prepareCollectionNotes.mockResolvedValue("ready");
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

  it.each([
    ["not-downloaded", "collection-notes-unavailable"],
    ["no-library", "no-hvsc"],
    ["demo-library", "no-radio-for-collection"],
  ] as const)("refuses the station when the tune notes are %s, and says %s", async (status, notice) => {
    pools.prepareCollectionNotes.mockResolvedValue(status);
    const client = makeClient();
    const { result } = renderHook(() => useSidRadio(paramsFor(client)));
    await act(async () => {
      await result.current.startCollectionRadio("classical");
    });
    expect(result.current.station).toBeNull();
    expect(result.current.notice).toBe(notice);
    expect(client.compute).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("names the missing tune notes when the members cannot be read after all", async () => {
    pools.loadCollectionPool.mockResolvedValue(null);
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.startCollectionRadio("classical");
    });
    expect(result.current.notice).toBe("collection-notes-unavailable");
  });

  it("says none of the collection is installed when its pool is empty", async () => {
    pools.loadCollectionPool.mockResolvedValue({ md5_48: [], songNr: [] });
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.startCollectionRadio("classical");
    });
    expect(result.current.notice).toBe("no-radio-for-collection");
  });

  it("plays every member however short, and counts each one heard only when it is reached", async () => {
    // The mood stations' 15 s minimum would drop the second member.
    const resolveDurationSeconds = vi.fn(async (path: string) => (path.includes("bbbbbbbbbbbb") ? 4 : 120));
    const client = makeClient();
    const params = paramsFor(client, { resolveDurationSeconds });
    const { result, rerender } = renderHook((props: Params) => useSidRadio(props), { initialProps: params });
    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });
    const items = vi.mocked(params.startPlaylist).mock.calls[0][0];
    expect(items.map((item) => item.path)).toEqual([
      "/HVSC/aaaaaaaaaaaa.sid",
      "/HVSC/bbbbbbbbbbbb.sid",
      "/HVSC/cccccccccccc.sid",
    ]);
    expect(items[1].durationMs).toBe(4000);
    rerender({ ...params, currentIndex: 1, playlistLength: 3 });
    expect(result.current.collectionProgress).toEqual({ heard: 2, total: 3 });
    await act(async () => {
      rerender({ ...params, currentIndex: 2, playlistLength: 3 });
    });
    expect(result.current.collectionProgress).toEqual({ heard: 3, total: 3 });
    await waitFor(() => expect(result.current.notice).toBe("collection-ended"));
  });

  it("does not say every tune was heard while tunes are still queued", async () => {
    const client = makeClient();
    const params = paramsFor(client, { playlistLength: 3 });
    const { result, rerender } = renderHook((props: Params) => useSidRadio(props), { initialProps: params });
    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });
    await act(async () => {
      rerender({ ...params, currentIndex: 1 });
    });
    // The refill found the pool empty while one tune was still ahead.
    await waitFor(() => expect(client.compute).toHaveBeenCalledTimes(2));
    expect(result.current.notice).toBeNull();
    await act(async () => {
      rerender({ ...params, currentIndex: 2 });
    });
    await waitFor(() => expect(result.current.notice).toBe("collection-ended"));
  });

  it("shows that it is fetching the tune notes while it waits for them, and only then", async () => {
    let finish!: (status: CollectionNotesStatus) => void;
    pools.prepareCollectionNotes.mockImplementation(async (onFetching) => {
      onFetching();
      return new Promise<CollectionNotesStatus>((resolve) => {
        finish = resolve;
      });
    });
    const params = paramsFor(makeClient());
    const { result } = renderHook(() => useSidRadio(params));
    let started!: Promise<void>;
    act(() => {
      started = result.current.startCollectionRadio("winners");
    });
    await waitFor(() => expect(result.current.preparingCollection).toBe(true));
    expect(params.startPlaylist).not.toHaveBeenCalled();
    await act(async () => {
      finish("ready");
      await started;
    });
    expect(result.current.preparingCollection).toBe(false);
    expect(params.startPlaylist).toHaveBeenCalledTimes(1);
  });

  it("stops showing the wait when preparing the tune notes fails", async () => {
    pools.prepareCollectionNotes.mockImplementation(async (onFetching) => {
      onFetching();
      throw new Error("disk full");
    });
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });
    expect(result.current.preparingCollection).toBe(false);
    expect(result.current.notice).toBe("start-failed");
  });

  it("prepares the tune notes once per start, not on every refill", async () => {
    const client = makeClient();
    const params = paramsFor(client);
    const { result, rerender } = renderHook((props: Params) => useSidRadio(props), { initialProps: params });
    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });
    await act(async () => {
      rerender({ ...params, currentIndex: 2, playlistLength: 3 });
    });
    await waitFor(() => expect(client.compute).toHaveBeenCalledTimes(2));
    expect(pools.prepareCollectionNotes).toHaveBeenCalledTimes(1);
  });

  it("starts nothing when the listener stops or starts another station while the notes download", async () => {
    let finish!: (status: CollectionNotesStatus) => void;
    pools.prepareCollectionNotes.mockImplementation(
      () =>
        new Promise<CollectionNotesStatus>((resolve) => {
          finish = resolve;
        }),
    );
    const client = makeClient();
    const params = paramsFor(client);
    const { result } = renderHook(() => useSidRadio(params));
    let started!: Promise<void>;
    act(() => {
      started = result.current.startCollectionRadio("winners");
    });
    await waitFor(() => expect(pools.prepareCollectionNotes).toHaveBeenCalled());
    act(() => result.current.stop());
    await act(async () => {
      finish("ready");
      await started;
    });
    expect(client.compute).not.toHaveBeenCalled();
    expect(params.startPlaylist).not.toHaveBeenCalled();
    expect(result.current.station).toBeNull();
  });

  /** A promise the test settles by hand. */
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  };

  /** Each collection start waits for the download until the test finishes it. */
  const fetchingNotes = () => {
    const pending: Array<(status: CollectionNotesStatus) => void> = [];
    pools.prepareCollectionNotes.mockImplementation(async (onFetching) => {
      onFetching();
      return new Promise<CollectionNotesStatus>((resolve) => pending.push(resolve));
    });
    return pending;
  };

  it("stops showing the wait for the tune notes as soon as the listener stops", async () => {
    fetchingNotes();
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    act(() => {
      void result.current.startCollectionRadio("winners");
    });
    await waitFor(() => expect(result.current.preparingCollection).toBe(true));
    act(() => result.current.stop());
    expect(result.current.preparingCollection).toBe(false);
  });

  it("stops showing the wait for the tune notes when another station is started", async () => {
    const pending = fetchingNotes();
    const client = makeClient();
    const compute = client.compute.getMockImplementation()!;
    client.compute.mockImplementation(async (request) => compute({ ...request, pool: request.pool ?? POOL }));
    const params = paramsFor(client);
    const { result } = renderHook(() => useSidRadio(params));
    let collectionStart!: Promise<void>;
    act(() => {
      collectionStart = result.current.startCollectionRadio("winners");
    });
    await waitFor(() => expect(result.current.preparingCollection).toBe(true));
    await act(async () => {
      await result.current.startStyleRadio(2, "Melodic");
    });
    expect(result.current.preparingCollection).toBe(false);
    expect(result.current.station).toMatchObject({ seedKind: "style", seedLabel: "Melodic" });

    await act(async () => {
      pending[0]("ready");
      await collectionStart;
    });
    expect(params.startPlaylist).toHaveBeenCalledTimes(1);
    expect(result.current.station).toMatchObject({ seedKind: "style", seedLabel: "Melodic" });
  });

  it("does not show the wait of a start that was abandoned before its download began", async () => {
    const beginFetch = deferred<void>();
    const download = deferred<CollectionNotesStatus>();
    let fetching = false;
    pools.prepareCollectionNotes.mockImplementationOnce(async (onFetching) => {
      await beginFetch.promise;
      onFetching();
      fetching = true;
      return download.promise;
    });
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    let started!: Promise<void>;
    act(() => {
      started = result.current.startCollectionRadio("winners");
    });
    act(() => result.current.stop());
    await act(async () => {
      beginFetch.resolve();
    });
    await waitFor(() => expect(fetching).toBe(true));
    expect(result.current.preparingCollection).toBe(false);
    await act(async () => {
      download.resolve("ready");
      await started;
    });
    expect(result.current.preparingCollection).toBe(false);
  });

  it("does not let a collection start superseded while the bundle loads replace the playlist", async () => {
    const pending = fetchingNotes();
    pools.prepareCollectionNotes.mockResolvedValueOnce("ready");
    const client = makeClient();
    const bundle = deferred<void>();
    const loaded = client.load.getMockImplementation()!;
    client.load.mockImplementationOnce(async () => {
      await bundle.promise;
      return loaded();
    });
    const params = paramsFor(client);
    const { result } = renderHook(() => useSidRadio(params));
    let first!: Promise<void>;
    act(() => {
      first = result.current.startCollectionRadio("winners");
    });
    await waitFor(() => expect(client.load).toHaveBeenCalledTimes(1));
    act(() => {
      void result.current.startCollectionRadio("classical");
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      bundle.resolve();
      await first;
    });
    expect(client.compute).not.toHaveBeenCalled();
    expect(params.startPlaylist).not.toHaveBeenCalled();
    expect(result.current.preparingCollection).toBe(true);

    await act(async () => {
      pending[0]("ready");
    });
    await waitFor(() => expect(params.startPlaylist).toHaveBeenCalledTimes(1));
    expect(result.current.station).toMatchObject({ seedKind: "collection", seedLabel: "Classical" });
  });

  it("does not let a collection start superseded during its first batch replace the playlist", async () => {
    const pending = fetchingNotes();
    pools.prepareCollectionNotes.mockResolvedValueOnce("ready");
    const client = makeClient();
    const firstBatch = deferred<void>();
    const compute = client.compute.getMockImplementation()!;
    client.compute.mockImplementationOnce(async (request) => {
      await firstBatch.promise;
      return compute(request);
    });
    const params = paramsFor(client);
    const { result } = renderHook(() => useSidRadio(params));
    let first!: Promise<void>;
    act(() => {
      first = result.current.startCollectionRadio("winners");
    });
    await waitFor(() => expect(client.compute).toHaveBeenCalledTimes(1));
    act(() => {
      void result.current.startCollectionRadio("classical");
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      firstBatch.resolve();
      await first;
    });
    expect(params.startPlaylist).not.toHaveBeenCalled();
    expect(result.current.station).toBeNull();
    expect(loadSidRadioSession()).toBeNull();
  });

  it("does not let a superseded station's refill decide why the new collection could not start", async () => {
    // Enough members that the first batch leaves the first station able to refill.
    const LARGE_POOL: CollectionPool = {
      md5_48: Array.from({ length: 20 }, (_, index) => index.toString(16).padStart(12, "0")),
      songNr: Array.from({ length: 20 }, () => 1),
    };
    const staleRefillPool = deferred<CollectionPool | null>();
    pools.loadCollectionPool
      .mockResolvedValueOnce(LARGE_POOL)
      .mockReturnValueOnce(staleRefillPool.promise)
      .mockResolvedValueOnce({ md5_48: [], songNr: [] });
    const client = makeClient();
    const newBatch = deferred<void>();
    const compute = client.compute.getMockImplementation()!;
    client.compute.mockImplementation(async (request) => {
      if (request.seed.kind === "collection" && request.seed.collectionId === "classical") await newBatch.promise;
      return compute({ ...request, count: Math.min(request.count, 10) });
    });
    const { result } = renderHook(() => useSidRadio(paramsFor(client, { currentIndex: 0, playlistLength: 3 })));
    await act(async () => {
      await result.current.startCollectionRadio("winners");
    });
    // The lookahead refill of the first station is now waiting on its members.
    await waitFor(() => expect(pools.loadCollectionPool).toHaveBeenCalledTimes(2));

    let second!: Promise<void>;
    act(() => {
      second = result.current.startCollectionRadio("classical");
    });
    await waitFor(() => expect(pools.loadCollectionPool).toHaveBeenCalledTimes(3));
    await act(async () => {
      staleRefillPool.resolve(null);
      await staleRefillPool.promise;
    });
    await act(async () => {
      newBatch.resolve();
      await second;
    });
    expect(result.current.notice).toBe("no-radio-for-collection");
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

  it("shows a resumed collection's progress before its first refill", async () => {
    saveSidRadioSession({
      seedKind: "collection",
      seedLabel: "Classical",
      seed: { kind: "collection", collectionId: "classical" },
      styleFilter: null,
      shuffleSeed: 99,
      rankingSnapshotId: "snap",
      excludeOrdinals: [0, 1],
    });
    const client = makeClient();
    const { result } = renderHook(() => useSidRadio(paramsFor(client, { currentIndex: 0, playlistLength: 6 })));
    await waitFor(() => expect(result.current.collectionProgress).toEqual({ heard: 0, total: 3 }));
    expect(client.compute).not.toHaveBeenCalled();
  });

  it("logs, and shows no progress, when a resumed collection's size cannot be read", async () => {
    pools.loadCollectionPool.mockRejectedValue(new Error("disk unreadable"));
    saveSidRadioSession({
      seedKind: "collection",
      seedLabel: "Classical",
      seed: { kind: "collection", collectionId: "classical" },
      styleFilter: null,
      shuffleSeed: 99,
      rankingSnapshotId: "snap",
      excludeOrdinals: [0],
    });
    const { addLog } = await import("@/lib/logging");
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient(), { currentIndex: 0, playlistLength: 6 })));
    await waitFor(() =>
      expect(addLog).toHaveBeenCalledWith("warn", "SID Radio: could not read the size of a resumed collection", {
        service: "sid-radio",
        collection: "classical",
        error: "disk unreadable",
      }),
    );
    expect(result.current.collectionProgress).toBeNull();
  });

  it("names the missing tune notes when a resumed collection cannot read its members", async () => {
    pools.loadCollectionPool.mockResolvedValue(null);
    saveSidRadioSession({
      seedKind: "collection",
      seedLabel: "Classical",
      seed: { kind: "collection", collectionId: "classical" },
      styleFilter: null,
      shuffleSeed: 99,
      rankingSnapshotId: "snap",
      excludeOrdinals: [],
    });
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient(), { currentIndex: 0, playlistLength: 1 })));
    await waitFor(() => expect(result.current.notice).toBe("collection-notes-unavailable"));
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
  const sizes = (winners: number) => ({ winners, classical: 0 }) as Record<StilCollectionId, number>;

  it("reads the playable members per collection for the launcher, once the path index is ready", async () => {
    pools.loadCollectionSizes.mockResolvedValue(sizes(2));
    const ensureResolvable = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient(), { ensureResolvable })));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toEqual({ winners: 2, classical: 0 });
    expect(ensureResolvable.mock.invocationCallOrder[0]).toBeLessThan(
      pools.loadCollectionSizes.mock.invocationCallOrder[0],
    );
  });

  it("keeps the same counts object when nothing changed, so the launcher does not re-render for nothing", async () => {
    pools.loadCollectionSizes.mockResolvedValue(sizes(2));
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient())));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    const first = result.current.collectionCounts;
    pools.loadCollectionSizes.mockResolvedValue(sizes(2));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toBe(first);
    pools.loadCollectionSizes.mockResolvedValue(sizes(3));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toEqual({ winners: 3, classical: 0 });
  });

  it("still reads the counts, and says so, when the path index fails to load", async () => {
    pools.loadCollectionSizes.mockResolvedValue(sizes(2));
    const { addLog } = await import("@/lib/logging");
    const ensureResolvable = vi.fn(async () => Promise.reject(new Error("no songlengths")));
    const { result } = renderHook(() => useSidRadio(paramsFor(makeClient(), { ensureResolvable })));
    await act(async () => {
      await result.current.ensureCollectionCounts();
    });
    expect(result.current.collectionCounts).toEqual({ winners: 2, classical: 0 });
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "SID Radio: path index was not ready for the collections",
      expect.objectContaining({ purpose: "counts", error: "no songlengths" }),
    );
  });

  it("leaves the counts unknown while STIL is not stored", async () => {
    pools.loadCollectionSizes.mockResolvedValue(null);
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
    expect(pools.loadCollectionSizes).not.toHaveBeenCalled();
  });
});
