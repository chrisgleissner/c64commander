/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SID_RADIO_STYLE_TILES, useSidRadio } from "@/pages/playFiles/hooks/useSidRadio";
import { rebuildMd548PathIndex, resetMd548PathIndex } from "@/lib/sidRadio/md5PathIndex";
import { clearAllRankings, getRanking, setRanking, simulateRankingRestartForTests } from "@/lib/sidRadio/rankingStore";
import { loadSidRadioSession, saveSidRadioSession } from "@/lib/sidRadio/sidRadioSession";
import { SidRadioWorkerClient } from "@/lib/sidRadio/sidRadioWorkerClient";
import type {
  SidRadioMainToWorker,
  SidRadioReadyStats,
  SidRadioStylePopulations,
  StationRequest,
} from "@/lib/sidRadio/sidRadioWorkerProtocol";
import { DEFAULT_STATION_BALANCE, type StationResult } from "@/lib/sidRadio/stationEngine";

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
  resetMd548PathIndex();
});

/**
 * Put one entry in the md5→path index, i.e. "HVSC is installed". The index is what resolves a
 * station's candidates to playable paths, so an empty one means nothing can play at all — a
 * distinct condition from a station that legitimately came back empty.
 */
const installMusic = () => {
  rebuildMd548PathIndex(";/MUSICIANS/H/Hubbard_Rob/Commando.sid\naabbccddeeff00112233445566778899=0:30\n", {
    force: true,
  });
};

const populationsWith = (overrides: Record<string, number>): SidRadioStylePopulations =>
  Object.fromEntries(SID_RADIO_STYLE_TILES.map((tile) => [tile.key, overrides[tile.key] ?? 1000]));

const makeClient = (stylePopulations: SidRadioStylePopulations = populationsWith({})) => {
  const client = {
    load: vi.fn().mockResolvedValue({ fileCount: 4, trackCount: 4, stylePopulations, engineThreadIsMain: false }),
    compute: vi.fn(async (request: StationRequest): Promise<StationResult> => {
      const pool = Array.from({ length: 60 }, (_, i) => i + 1).filter((o) => !request.exclude.includes(o));
      return {
        candidates: pool.slice(0, request.count).map((trackOrdinal) => ({
          trackOrdinal,
          md5_48: `m${trackOrdinal}`,
          songNr: 1,
          score: 10 - trackOrdinal,
          reason: "similar" as const,
          fileTrackOrdinals: [trackOrdinal],
        })),
      };
    }),
    terminate: vi.fn(),
  };
  return client;
};

const baseParams = (client: ReturnType<typeof makeClient>, overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  startPlaylist: vi.fn(),
  appendItems: vi.fn(),
  advanceToNext: vi.fn(),
  currentIndex: 0,
  playlistLength: 10,
  clientFactory: () => client as never,
  resolvePath: (md5: string) => `/HVSC/${md5}.sid`,
  randomSeed: () => 12345,
  ...overrides,
});

describe("useSidRadio", () => {
  it("starts a Song station: loads the worker, computes, and seeds the playlist", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect(client.load).toHaveBeenCalledTimes(1);
    expect(client.compute).toHaveBeenCalled();
    expect(params.startPlaylist).toHaveBeenCalledTimes(1);
    const items = (params.startPlaylist as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].request).toMatchObject({ source: "hvsc" });
    expect(result.current.active).toBe(true);
    expect(result.current.station).toMatchObject({ seedKind: "song", seedLabel: "Commando", shuffleSeed: 12345 });
  });

  it("does nothing when disabled", async () => {
    const client = makeClient();
    const params = baseParams(client, { enabled: false });
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect(client.load).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it("stops the station", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
    expect(result.current.station).toBeNull();
  });

  it("✕ steer records the dislike and skips to the next track", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    await act(async () => {
      result.current.steer("cafebabecafebabecafebabecafebabe", "notForMe");
    });
    expect(getRanking("cafebabecafebabecafebabecafebabe")).toBe("notForMe");
    expect(params.advanceToNext).toHaveBeenCalledTimes(1);
  });

  it("♥ steer records a like without skipping", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    await act(async () => {
      result.current.steer("0123456789abcdef0123456789abcdef", "like");
    });
    expect(getRanking("0123456789abcdef0123456789abcdef")).toBe("like");
    expect(params.advanceToNext).not.toHaveBeenCalled();
  });

  it("persists the station descriptor on start and clears it on stop (D15)", async () => {
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    const saved = loadSidRadioSession();
    expect(saved).toMatchObject({ seedKind: "song", seedLabel: "Commando", shuffleSeed: 12345 });
    expect(saved?.excludeOrdinals.length).toBeGreaterThan(0);
    act(() => result.current.stop());
    expect(loadSidRadioSession()).toBeNull();
  });

  it("refills the queue as the cursor nears the tail and records auto-advances", async () => {
    const client = makeClient();
    const params = baseParams(client, { playlistLength: 10, currentIndex: 0 });
    const { result, rerender } = renderHook((p: ReturnType<typeof baseParams>) => useSidRadio(p), {
      initialProps: params,
    });
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    // Advance the cursor to within the refill threshold of the tail.
    await act(async () => {
      rerender({ ...params, currentIndex: 8, playlistLength: 10 });
    });
    await waitFor(() => expect(params.appendItems).toHaveBeenCalled());
    const appended = (params.appendItems as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(appended.length).toBeGreaterThan(0);
  });

  /**
   * HARD25-005: the lookahead-refill effect guards against a superseded generation
   * (another station started, or stop() called) but the unmount cleanup never bumped
   * the generation counter. A refill already in flight when the component unmounted
   * would resolve later and still pass its stale generation check, calling appendItems
   * (which writes to the playlist store the caller owns, not local state) for a station
   * the user already left.
   */
  it("does not append refill items that resolve after the hook has unmounted", async () => {
    const client = makeClient();
    let resolveRefillCompute: ((result: StationResult) => void) | null = null;
    let computeCalls = 0;
    client.compute = vi.fn((request: StationRequest): Promise<StationResult> => {
      computeCalls += 1;
      if (computeCalls === 1) {
        // The initial station-start refill: resolve immediately, as the other tests do.
        // Exactly LOOKAHEAD (10) candidates, so the provider's buffer is fully consumed
        // and does not carry leftover candidates that would let the second refill below
        // answer itself from the buffer without a genuine second compute() call.
        const pool = Array.from({ length: 10 }, (_, i) => i + 1).filter((o) => !request.exclude.includes(o));
        return Promise.resolve({
          candidates: pool.slice(0, request.count).map((trackOrdinal) => ({
            trackOrdinal,
            md5_48: `m${trackOrdinal}`,
            songNr: 1,
            score: 10 - trackOrdinal,
            reason: "similar" as const,
            fileTrackOrdinals: [trackOrdinal],
          })),
        });
      }
      // The lookahead refill triggered below: held open until after unmount.
      return new Promise<StationResult>((resolve) => {
        resolveRefillCompute = resolve;
      });
    });
    const params = baseParams(client, { playlistLength: 10, currentIndex: 0 });
    const { result, rerender, unmount } = renderHook((p: ReturnType<typeof baseParams>) => useSidRadio(p), {
      initialProps: params,
    });
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    // Advance the cursor to within the refill threshold of the tail — starts the
    // lookahead refill, whose compute() call is now held open above.
    act(() => {
      rerender({ ...params, currentIndex: 8, playlistLength: 10 });
    });
    await waitFor(() => expect(computeCalls).toBe(2));

    unmount();
    await act(async () => {
      // Enough candidates to satisfy the refill's full batch in one round — otherwise
      // the provider's internal loop would issue a further compute() call that this
      // test never answers, and the outer refill() promise would simply never settle.
      resolveRefillCompute?.({
        candidates: Array.from({ length: 20 }, (_, i) => ({
          trackOrdinal: 100 + i,
          md5_48: `m${100 + i}`,
          songNr: 1,
          score: 1,
          reason: "similar" as const,
          fileTrackOrdinals: [100 + i],
        })),
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(params.appendItems).not.toHaveBeenCalled();
  });

  it("surfaces a 'no radio for this tune' notice when the seed has no neighbours (Q5)", async () => {
    const client = makeClient();
    client.compute = vi.fn(async () => ({ candidates: [], empty: "no-neighbours" }));
    // Music IS installed here — this is a tune with no neighbours, not an app with nothing to play.
    // Without the index the honest answer is the HVSC one, which the next test covers.
    installMusic();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toBe("no-radio-for-tune");
    expect(params.startPlaylist).not.toHaveBeenCalled();
    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });

  it("reads the style populations once and reuses them", async () => {
    const client = makeClient(populationsWith({ theme_hunter: 0 }));
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    expect(result.current.stylePopulations).toBeNull();
    await act(async () => {
      await result.current.ensureStylePopulations();
      await result.current.ensureStylePopulations();
    });
    expect(client.load).toHaveBeenCalledTimes(1);
    expect(result.current.stylePopulations).toMatchObject({ theme_hunter: 0, fast_paced: 1000 });
  });

  it("leaves the populations unknown rather than failing when the bundle cannot be read", async () => {
    const client = makeClient();
    client.load = vi.fn().mockRejectedValue(new Error("bundle missing"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await expect(result.current.ensureStylePopulations()).resolves.toBeNull();
    });
    expect(result.current.stylePopulations).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("Surprise never rolls a style the export left empty", async () => {
    // theme_hunter (bit 8) matched 0 tracks in the release preceding the pinned
    // 0.8.0, and the old picker chose uniformly over all nine bits.
    const client = makeClient(populationsWith({ theme_hunter: 0 }));
    const params = baseParams(client, { randomSeed: () => 8 });
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSurpriseRadio();
    });
    expect(result.current.station?.styleBit).not.toBe(8);
    expect(result.current.station?.seedLabel).not.toBe("Game Themes");
  });

  it("Surprise says so rather than starting nothing when no style has members", async () => {
    const client = makeClient(Object.fromEntries(SID_RADIO_STYLE_TILES.map((tile) => [tile.key, 0])));
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSurpriseRadio();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toBe("no-radio");
    expect(params.startPlaylist).not.toHaveBeenCalled();
  });

  /**
   * With no HVSC installed the md5→path index is empty, so every candidate the station produces
   * resolves to nothing and NO station can play — including the Likes one. The old wording told the
   * user to like a few tunes, which cannot help: there is nothing installed to like, and liking
   * would not make a station playable. Observed on a Pixel 4 by tapping a style tile that the
   * launcher had just advertised as holding 17,574 tracks.
   */
  it("names HVSC, not likes, when candidates resolve to nothing because none are installed", async () => {
    const client = makeClient();
    const params = baseParams(client, { resolvePath: () => null });
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startStyleRadio(1, "Chill / Ambient");
    });
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toBe("no-hvsc");
    expect(params.startPlaylist).not.toHaveBeenCalled();
  });

  /**
   * A station that runs out does it at the tail of the queue — the one place the user cannot tell
   * "ended" from "broken": playback stops on the last track and Next does nothing because there is
   * no next, while staying enabled (hold-to-seek keeps it live). Seen on a Pixel 4: a station the
   * launcher sized at 17,574 tracks stopped after 25 with no explanation at all.
   */
  it("says the station has ended when a refill comes back empty", async () => {
    installMusic();
    const client = makeClient();
    const params = baseParams(client, { playlistLength: 10, currentIndex: 0 });
    const { result, rerender } = renderHook((p: ReturnType<typeof baseParams>) => useSidRadio(p), {
      initialProps: params,
    });
    await act(async () => {
      await result.current.startStyleRadio(1, "Chill / Ambient");
    });
    expect(result.current.notice).toBeNull();

    // The station dries up. Drain whatever the provider still holds buffered, then keep the cursor
    // at the tail until the empty compute is what a refill actually sees.
    client.compute = vi.fn(async () => ({ candidates: [], empty: "exhausted" as const }));
    for (let cursor = 6; cursor <= 9 && result.current.notice === null; cursor += 1) {
      await act(async () => {
        rerender({ ...params, currentIndex: cursor, playlistLength: 10 });
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(result.current.notice).toBe("station-ended"));
  });

  it("resumes the chip from a saved session on mount (D15)", () => {
    saveSidRadioSession({
      seedKind: "style",
      seedLabel: "Fast-Paced",
      seed: { kind: "style", styleBit: 0 },
      styleFilter: 0,
      shuffleSeed: 777,
      rankingSnapshotId: "snap",
      excludeOrdinals: [1, 2, 3],
    });
    const client = makeClient();
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    expect(result.current.active).toBe(true);
    expect(result.current.station).toMatchObject({ seedKind: "style", seedLabel: "Fast-Paced", shuffleSeed: 777 });
    // Resume rebuilds the chip only — it does not auto-replace the playlist.
    expect(params.startPlaylist).not.toHaveBeenCalled();
  });

  // A resumed station never passes through `start`, and its bundle loads lazily inside the worker on
  // the first compute. So nothing recorded which corpus had been parsed, and a relaunched device
  // reported `corpusGraphFlags: null` for a station that was visibly running — observed on the
  // Pixel 4 as `fmt null flags 0x0000` in a HIL run against a live station.
  it("names the corpus it resumed onto (D15)", async () => {
    saveSidRadioSession({
      seedKind: "song",
      seedLabel: "Race.sid",
      seed: { kind: "song", md5_48: "m1" },
      styleFilter: null,
      shuffleSeed: 42,
      rankingSnapshotId: "snap",
      excludeOrdinals: [1],
    });
    const client = makeClient();
    client.load = vi.fn().mockResolvedValue({
      fileCount: 4,
      trackCount: 4,
      stylePopulations: populationsWith({}),
      engineThreadIsMain: false,
      version: 2,
      graphFlags: 0x0006,
    });

    renderHook(() => useSidRadio(baseParams(client)));

    const { getSidRadioStats } = await import("@/lib/sidRadio/sidRadioStats");
    await waitFor(() => {
      const stats = getSidRadioStats();
      expect(stats.corpusBinaryFormatVersion).toBe(2);
      expect(stats.corpusGraphFlags).toBe(0x0006);
    });
  });

  it("refuses a station for a style with no members even when the tap beats the counts", async () => {
    // The sheet opens before the populations are read, so the disabled tile
    // cannot be the enforcement point — a tap that lands first must still be
    // refused, at the one place the counts are already known.
    const client = makeClient(populationsWith({ theme_hunter: 0 }));
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    expect(result.current.stylePopulations).toBeNull();
    await act(async () => {
      await result.current.startStyleRadio(8, "Game Themes");
    });
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toBe("no-radio");
    expect(client.compute).not.toHaveBeenCalled();
    expect(params.startPlaylist).not.toHaveBeenCalled();
  });

  it("refuses that style composed over Likes too, which admits nothing either", async () => {
    const client = makeClient(populationsWith({ theme_hunter: 0 }));
    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startStyleRadio(8, "Game Themes", true);
    });
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toBe("no-radio");
    expect(client.compute).not.toHaveBeenCalled();
  });
});

/**
 * The launcher preloads the populations as its sheet opens (`PlayFilesPage`), and a
 * tile tap starts a station straight after: two `client.load()` calls that overlap
 * by design. Driven through the *real* `SidRadioWorkerClient` rather than a mock,
 * because the defect lived in the protocol layer — a second `load` message replaced
 * the client's single pending resolver, so the preload was never answered and
 * rejected on its 15 s timeout, whose stale timer then cleared the newer load.
 */
describe("useSidRadio launcher preload overlapping a station start", () => {
  class GatedWorker extends EventTarget {
    loads = 0;

    postMessage(message: SidRadioMainToWorker) {
      if (message.type === "load") {
        this.loads += 1; // answered only when the test releases it, so both loads overlap
        return;
      }
      const { id, request } = message;
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "candidates",
              id,
              candidates: Array.from({ length: request.count }, (_, index) => ({
                trackOrdinal: index + 1,
                md5_48: `m${index + 1}`,
                songNr: 1,
                score: 1,
                reason: "similar" as const,
                fileTrackOrdinals: [index + 1],
              })),
            },
          }),
        ),
      );
    }

    releaseReady(stats: SidRadioReadyStats) {
      this.dispatchEvent(new MessageEvent("message", { data: { type: "ready", stats } }));
    }

    terminate() {}
  }

  const readyStats = (): SidRadioReadyStats => ({
    bundleLoadMs: 1,
    reverseIndexMs: 1,
    memoryEstimateBytes: 1024,
    fileCount: 4,
    trackCount: 4,
    edgeCount: 4,
    styleCount: 9,
    stylePopulations: populationsWith({}),
    engineThreadIsMain: false,
  });

  it("reads the bundle once and answers both callers", async () => {
    const worker = new GatedWorker();
    const client = new SidRadioWorkerClient(() => worker as unknown as Worker);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const params = baseParams(client as unknown as ReturnType<typeof makeClient>);
    const { result } = renderHook(() => useSidRadio(params));

    await act(async () => {
      const preload = result.current.ensureStylePopulations();
      const started = result.current.startStyleRadio(0, "Fast-Paced");
      expect(worker.loads).toBe(1);
      worker.releaseReady(readyStats());
      const [populations] = await Promise.all([preload, started]);
      expect(populations).toMatchObject({ fast_paced: 1000 });
    });

    expect(result.current.station).toMatchObject({ seedKind: "style", seedLabel: "Fast-Paced" });
    expect(params.startPlaylist).toHaveBeenCalledTimes(1);
    // The preload resolved on its own load rather than timing out into a warning.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    client.terminate();
  });
});

/**
 * Feedback has to shape a station whatever seeded it (E3), and it has to survive an app restart.
 *
 * The ♥/✕ signal is durable, but only a *write* used to hydrate the in-memory cache it is read from,
 * and nothing on the start or resume path wrote. So a relaunched app steered every station from an
 * empty likes/not-for-me list until the user happened to rate something in that session.
 */
describe("useSidRadio feedback reaches the engine", () => {
  const LIKED = "0123456789abcdef0123456789abcdef";
  const REJECTED = "fedcba9876543210fedcba9876543210";

  const requestFor = (client: ReturnType<typeof makeClient>): StationRequest =>
    client.compute.mock.calls[0][0] as StationRequest;

  const withStoredFeedbackAfterRelaunch = async () => {
    await setRanking(LIKED, "like");
    await setRanking(REJECTED, "notForMe");
    await simulateRankingRestartForTests();
  };

  it("shapes a Song station with the stored likes and rejections", async () => {
    await withStoredFeedbackAfterRelaunch();
    const client = makeClient();
    const { result } = renderHook(() => useSidRadio(baseParams(client)));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect(requestFor(client).seed).toEqual({ kind: "song", md5_48: "aabbccddeeff" });
    expect(requestFor(client).likes).toEqual([LIKED]);
    expect(requestFor(client).notForMe).toEqual([REJECTED]);
  });

  it("shapes a category station with the same stored likes and rejections", async () => {
    await withStoredFeedbackAfterRelaunch();
    const client = makeClient();
    const { result } = renderHook(() => useSidRadio(baseParams(client)));
    await act(async () => {
      await result.current.startStyleRadio(1, "Chill / Ambient");
    });
    expect(requestFor(client).seed).toEqual({ kind: "style", styleBit: 1 });
    expect(requestFor(client).styleFilter).toBe(1);
    expect(requestFor(client).likes).toEqual([LIKED]);
    expect(requestFor(client).notForMe).toEqual([REJECTED]);
  });

  it("shapes a category station composed over Likes", async () => {
    await withStoredFeedbackAfterRelaunch();
    const client = makeClient();
    const { result } = renderHook(() => useSidRadio(baseParams(client)));
    await act(async () => {
      await result.current.startStyleRadio(1, "Chill / Ambient", true);
    });
    expect(requestFor(client).seed).toEqual({ kind: "taste" });
    expect(requestFor(client).styleFilter).toBe(1);
    expect(requestFor(client).likes).toEqual([LIKED]);
  });
});

describe("useSidRadio drifts the query and persists its aim", () => {
  it("sends nothing recent on the first compute and the played tail thereafter", async () => {
    const client = makeClient();
    let queued = 0;
    const params = baseParams(client, {
      playlistLength: 0,
      currentIndex: 0,
      startPlaylist: vi.fn((items: unknown[]) => {
        queued = items.length;
      }),
      appendItems: vi.fn((items: unknown[]) => {
        queued += items.length;
      }),
    });
    const { result, rerender } = renderHook((p: ReturnType<typeof baseParams>) => useSidRadio(p), {
      initialProps: params,
    });
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    expect((client.compute.mock.calls[0][0] as StationRequest).recent).toEqual([]);

    // Walk the cursor to the tail repeatedly until the lookahead buffer is spent and the station has
    // to ask the engine again — that second ask is the one carrying the drift.
    for (let round = 0; round < 8 && client.compute.mock.calls.length < 2; round += 1) {
      await act(async () => {
        rerender({ ...params, currentIndex: queued - 1, playlistLength: queued });
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    const later = client.compute.mock.calls.at(-1)![0] as StationRequest;
    expect(later.recent).toHaveLength(DEFAULT_STATION_BALANCE.recentWindow);
    // Most recent first, and the mock pool is emitted in ascending order, so the tail counts down.
    expect(later.recent).toEqual([...later.recent].sort((a, b) => b - a));
  });

  it("persists the recent window so a resumed station keeps its aim (D15)", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSidRadio(baseParams(client)));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    const saved = loadSidRadioSession();
    expect(saved?.recentOrdinals?.length).toBeGreaterThan(0);
    expect(saved?.excludeOrdinals).toEqual(expect.arrayContaining(saved!.recentOrdinals!));
  });

  it("hands a resumed provider its saved aim, not the tail of the exclude set", async () => {
    saveSidRadioSession({
      seedKind: "song",
      seedLabel: "Commando",
      seed: { kind: "song", md5_48: "aabbccddeeff" },
      styleFilter: null,
      shuffleSeed: 777,
      rankingSnapshotId: "snap",
      excludeOrdinals: [1, 2, 3, 4, 5, 6, 7],
      recentOrdinals: [3, 2, 1],
    });
    const client = makeClient();
    const params = baseParams(client, { playlistLength: 10, currentIndex: 8 });
    const { result } = renderHook(() => useSidRadio(params));
    expect(result.current.active).toBe(true);
    await waitFor(() => expect(client.compute).toHaveBeenCalled());
    expect((client.compute.mock.calls[0][0] as StationRequest).recent).toEqual([3, 2, 1]);
  });
});

/**
 * `emittedSequence` is the evidence behind the G11 `--shuffle-replay` gate:
 * the HIL starts a station twice with the same pinned `shuffleSeed` and
 * asserts the sequences match, then with a different seed and asserts they
 * diverge. Both assertions are vacuous unless the sequence identifies *tunes*
 * and is produced by the station rather than by playback. It used to be
 * appended on auto-advance with the playlist cursor, which is 0,1,2,… for
 * every station and every seed, so the gate compared two counters.
 */
describe("useSidRadio emittedSequence identity", () => {
  it("records the tune ordinals the station emitted, not the playlist cursor", async () => {
    const { getSidRadioStats } = await import("@/lib/sidRadio/sidRadioStats");
    const client = makeClient();
    // Emit a pool whose ordinals cannot be confused with playlist indices.
    const pool = [700, 701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711];
    client.compute = vi.fn(async (request: StationRequest): Promise<StationResult> => ({
      candidates: pool
        .filter((o) => !request.exclude.includes(o))
        .slice(0, request.count)
        .map((trackOrdinal) => ({
          trackOrdinal,
          md5_48: `m${trackOrdinal}`,
          songNr: 1,
          score: 1,
          reason: "similar" as const,
          fileTrackOrdinals: [trackOrdinal],
        })),
    }));

    const params = baseParams(client);
    const { result } = renderHook(() => useSidRadio(params));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });

    const sequence = getSidRadioStats().emittedSequence;
    expect(sequence.length).toBeGreaterThan(0);
    // The tunes the engine chose, in the order it chose them -- never 0,1,2,…
    expect(sequence).toEqual(pool.slice(0, sequence.length));
    expect(sequence[0]).toBe(700);
  });

  it("counts auto-advances separately from the emitted sequence", async () => {
    const { getSidRadioStats } = await import("@/lib/sidRadio/sidRadioStats");
    const client = makeClient();
    let currentIndex = 0;
    const params = baseParams(client);
    const { result, rerender } = renderHook(() => useSidRadio({ ...params, currentIndex }));
    await act(async () => {
      await result.current.startSongRadio("aabbccddeeff", "Commando");
    });
    const emittedBefore = getSidRadioStats().emittedSequence.length;

    for (const next of [1, 2]) {
      currentIndex = next;
      await act(async () => {
        rerender();
      });
    }

    // Advancing the cursor counts advances; it must not append to the
    // determinism sequence, which belongs to the station, not to playback.
    expect(getSidRadioStats().tracksAutoAdvanced).toBe(2);
    expect(getSidRadioStats().emittedSequence).toHaveLength(emittedBefore);
  });
});
