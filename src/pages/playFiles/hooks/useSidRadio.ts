/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlaylistItem } from "@/pages/playFiles/types";
import { getPlayCategory } from "@/lib/playback/fileTypes";
import { getMd548PathIndexStats, resolveVirtualPath } from "@/lib/sidRadio/md5PathIndex";
import {
  getNotForMeMd5s,
  getRankingSnapshot,
  getLikedMd5s,
  loadRankings,
  setRanking,
  type RankingSignal,
} from "@/lib/sidRadio/rankingStore";
import { SidRadioWorkerClient } from "@/lib/sidRadio/sidRadioWorkerClient";
import type { SidRadioStylePopulations } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import { loadSidRadioMinSeconds } from "@/lib/config/appSettings";
import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import { DEFAULT_STATION_BALANCE, type StationSeed } from "@/lib/sidRadio/stationEngine";
import {
  recordAutoAdvance,
  recordEmitted,
  recordRefill,
  recordSkip,
  resetSidRadioStats,
  updateSidRadioStats,
} from "@/lib/sidRadio/sidRadioStats";
import {
  clearSidRadioSession,
  loadSidRadioSession,
  resumeRecentOrdinals,
  saveSidRadioSession,
  type SidRadioSessionDescriptor,
} from "@/lib/sidRadio/sidRadioSession";

const basename = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

export interface ActiveStation {
  seedKind: "song" | "style" | "taste";
  seedLabel: string;
  styleBit: number | null;
  shuffleSeed: number;
  rankingSnapshotId: string;
}

export interface UseSidRadioParams {
  /** Whether SID Radio is enabled (sidRadioEnabled). */
  enabled: boolean;
  /** Start a fresh playlist (replaces the queue) and begin playing. */
  startPlaylist: (items: PlaylistItem[]) => void | Promise<void>;
  /** Append refill items to the tail of the current playlist. */
  appendItems: (items: PlaylistItem[]) => void;
  /** Advance to the next track (used by ✕ skip). */
  advanceToNext?: () => void;
  /** Current cursor + queue length (drives lookahead refills). */
  currentIndex: number;
  playlistLength: number;
  /** Test seams. */
  clientFactory?: () => SidRadioWorkerClient;
  resolvePath?: (md5_48: string) => string | null;
  /**
   * Songlength lookup, so the station can leave out sound effects.
   *
   * HVSC is not only music — it carries jingles, one-shot effects and test tones, and a station that
   * serves them between pieces reads as broken. Optional: without it the station plays everything,
   * which is what the tests and the web build do.
   */
  resolveDurationSeconds?: (virtualPath: string, songIndex: number) => number | null | Promise<number | null>;
  randomSeed?: () => number;
}

export interface UseSidRadioResult {
  active: boolean;
  station: ActiveStation | null;
  startSongRadio: (md5_48: string, seedLabel: string) => Promise<void>;
  /** Style station; `fromLikes` composes a style filter over a Likes seed (D10). */
  startStyleRadio: (styleBit: number, label: string, fromLikes?: boolean) => Promise<void>;
  startTasteRadio: () => Promise<void>;
  /** Surprise: a random style / broad Deep-Discovery station (§5.2). */
  startSurpriseRadio: () => Promise<void>;
  /** Per-style track counts, or null until the bundle has been read. */
  stylePopulations: SidRadioStylePopulations | null;
  /** Read the populations so the launcher can size (and retire) its tiles. */
  ensureStylePopulations: () => Promise<SidRadioStylePopulations | null>;
  steer: (md5: string, signal: RankingSignal) => void;
  stop: () => void;
  /** A transient empty/degraded notice (spec §5.2 Q5), or null. */
  notice: "no-radio-for-tune" | "no-radio" | "no-hvsc" | "station-ended" | null;
  dismissNotice: () => void;
}

const buildStationItem = (input: { virtualPath: string; songIndex: number; trackOrdinal: number }): PlaylistItem => ({
  id: `radio:${input.virtualPath}#${input.songIndex}`,
  request: { source: "hvsc", path: input.virtualPath, songNr: input.songIndex },
  category: getPlayCategory(input.virtualPath) ?? "sid",
  label: basename(input.virtualPath),
  path: input.virtualPath,
});

const LOOKAHEAD = 10;
const REFILL_THRESHOLD = 4;

/** The 9 style tiles (spec §5.4) — mask bit → export key + friendly label + blurb. */
export const SID_RADIO_STYLE_TILES: ReadonlyArray<{ bit: number; key: string; label: string; blurb: string }> = [
  { bit: 0, key: "fast_paced", label: "Fast-Paced", blurb: "High-energy, driving tunes" },
  { bit: 1, key: "slow_ambient", label: "Chill / Ambient", blurb: "Slow, atmospheric" },
  { bit: 2, key: "melodic", label: "Melodic", blurb: "Strong, hummable melodies" },
  { bit: 3, key: "experimental", label: "Experimental", blurb: "Off the beaten track" },
  { bit: 4, key: "nostalgic", label: "Nostalgic", blurb: "Classic, wistful vibes" },
  { bit: 5, key: "composer_focus", label: "Composer Deep-Dive", blurb: "Stays close to a composer's signature" },
  { bit: 6, key: "era_explorer", label: "Era Explorer", blurb: "Roams a musical era" },
  { bit: 7, key: "deep_discovery", label: "Deep Cuts", blurb: "Rarely-heard corners of HVSC" },
  { bit: 8, key: "theme_hunter", label: "Game Themes", blurb: "Themes & loader tunes" },
];

/** Taste-Radio unlock threshold (D1). */
export const SID_RADIO_TASTE_UNLOCK_LIKES = 5;

/**
 * A style the export left empty has no station behind it (spec §5.4).
 *
 * `null` is "not read yet", and it is deliberately permissive: the launcher opens
 * as soon as it is tapped rather than waiting on the bundle, so a tile with no
 * counts yet is offered rather than greyed out and then un-greyed a moment later.
 * That makes this a presentation guard, not the enforcement point — {@link
 * isStyleBitPopulated} refuses the station itself, once the counts are known.
 */
export const isStylePopulated = (populations: SidRadioStylePopulations | null, key: string): boolean =>
  populations === null || populations[key] !== 0;

/**
 * The same test against a mask bit, for the moment the populations have actually
 * arrived. An unknown bit counts as populated — this refuses empty stations, it
 * does not police the tile table (§8.1 already asserts that mapping). Internal:
 * it is reached through `start()`, and asserted through what `start()` does.
 */
const isStyleBitPopulated = (populations: SidRadioStylePopulations, bit: number): boolean =>
  !SID_RADIO_STYLE_TILES.some((tile) => tile.bit === bit && populations[tile.key] === 0);

/**
 * Orchestrates a SID Radio station (spec §6.1 `useSidRadio`): owns the worker
 * lifecycle + queue provider, produces `PlaylistItem`s into the **existing**
 * playback engine, keeps the queue refilled ahead of the cursor, and steers on
 * ♥/✕. A station is a *queue provider*, never a parallel transport (principle 1).
 */

/**
 * A station's `shuffleSeed` is random by design — that randomness *is* the
 * intrinsic variety two starts of the same station are meant to have (D12).
 * Gate G11 nonetheless has to prove the sequence is reproducible **on
 * hardware**, and that needs the seed pinned from outside the app, because
 * nothing in the UI can set it. `--shuffle-replay` writes this key, starts a
 * station, restarts with the same value and asserts the two emitted sequences
 * are identical.
 *
 * Absent the key — which is to say always, in normal use — this is an ordinary
 * random seed. It is read at station start rather than cached so a HIL run can
 * change it between starts without reloading.
 */
const PINNED_SHUFFLE_SEED_KEY = "c64u_sid_radio_pinned_shuffle_seed";

const defaultRandomSeed = (): number => {
  const pinned = typeof localStorage === "undefined" ? null : localStorage.getItem(PINNED_SHUFFLE_SEED_KEY);
  if (pinned !== null) {
    const parsed = Number.parseInt(pinned, 10);
    if (Number.isFinite(parsed)) return parsed >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff);
};
export const useSidRadio = (params: UseSidRadioParams): UseSidRadioResult => {
  const { enabled, startPlaylist, appendItems, currentIndex, playlistLength } = params;
  const resolvePath = params.resolvePath ?? ((md5) => resolveVirtualPath(md5));
  const randomSeed = params.randomSeed ?? defaultRandomSeed;

  const [station, setStation] = useState<ActiveStation | null>(null);
  const [notice, setNotice] = useState<"no-radio-for-tune" | "no-radio" | "no-hvsc" | "station-ended" | null>(null);
  const [stylePopulations, setStylePopulations] = useState<SidRadioStylePopulations | null>(null);
  const stylePopulationsRef = useRef<SidRadioStylePopulations | null>(null);
  const stylePopulationsLoadRef = useRef<Promise<SidRadioStylePopulations | null> | null>(null);
  const clientRef = useRef<SidRadioWorkerClient | null>(null);
  const providerRef = useRef<StationQueueProvider | null>(null);
  const seedRef = useRef<{ seed: StationSeed; styleFilter: number | null; shuffleSeed: number }>({
    seed: { kind: "song" },
    styleFilter: null,
    shuffleSeed: 0,
  });
  const refillingRef = useRef(false);

  const ensureClient = useCallback((): SidRadioWorkerClient => {
    if (!clientRef.current) {
      clientRef.current = params.clientFactory ? params.clientFactory() : new SidRadioWorkerClient();
    }
    return clientRef.current;
  }, [params]);

  // Set once per session: the populations are a pure function of the pinned
  // bundle, so the stored reference stays stable and cannot re-trigger effects.
  const rememberStylePopulations = useCallback((populations: SidRadioStylePopulations) => {
    if (stylePopulationsRef.current) return;
    stylePopulationsRef.current = populations;
    setStylePopulations(populations);
  }, []);

  const ensureStylePopulations = useCallback(async (): Promise<SidRadioStylePopulations | null> => {
    if (!enabled) return null;
    if (stylePopulationsRef.current) return stylePopulationsRef.current;
    stylePopulationsLoadRef.current ??= ensureClient()
      .load()
      .then((stats) => {
        rememberStylePopulations(stats.stylePopulations);
        return stats.stylePopulations;
      })
      .catch((error: unknown) => {
        stylePopulationsLoadRef.current = null;
        console.warn("SID Radio: could not read style populations from the similarity bundle", error);
        return null;
      });
    return stylePopulationsLoadRef.current;
  }, [enabled, ensureClient, rememberStylePopulations]);

  const buildProvider = useCallback(
    (
      seed: StationSeed,
      styleFilter: number | null,
      shuffleSeed: number,
      initialExclude: number[] = [],
      initialRecent: number[] = [],
    ) => {
      const client = ensureClient();
      seedRef.current = { seed, styleFilter, shuffleSeed };
      return new StationQueueProvider({
        lookahead: LOOKAHEAD,
        initialExclude,
        initialRecent,
        minSeconds: loadSidRadioMinSeconds(),
        resolveDuration: params.resolveDurationSeconds,
        computeCandidates: async (exclude, recent, count) => {
          // The ♥/✕ signal is durable but the in-memory cache is not, and nothing else on the
          // resume path reads it back: without this a relaunched app steered every station from an
          // empty likes/not-for-me list until the user happened to rate something. Idempotent, so
          // every later refill pays nothing.
          await loadRankings();
          return client.compute({
            seed,
            styleFilter,
            shuffleSeed,
            likes: getLikedMd5s(),
            notForMe: getNotForMeMd5s(),
            exclude,
            recent,
            count,
          });
        },
        resolvePath,
        buildItem: ({ virtualPath, songIndex, trackOrdinal }) => {
          // The determinism proof behind G11: emission order is a pure function
          // of the seed, so it is recorded here, where the station decides, and
          // not where playback happens to arrive.
          recordEmitted(trackOrdinal);
          return buildStationItem({ virtualPath, songIndex, trackOrdinal });
        },
      });
    },
    [ensureClient, resolvePath],
  );

  const persistSession = useCallback((descriptor: ActiveStation, seed: StationSeed) => {
    saveSidRadioSession({
      seedKind: descriptor.seedKind,
      seedLabel: descriptor.seedLabel,
      seed,
      styleFilter: descriptor.styleBit,
      shuffleSeed: descriptor.shuffleSeed,
      rankingSnapshotId: descriptor.rankingSnapshotId,
      excludeOrdinals: providerRef.current?.excludedOrdinals ?? [],
      recentOrdinals: providerRef.current?.recentOrdinals ?? [],
    });
  }, []);

  const start = useCallback(
    async (seed: StationSeed, styleFilter: number | null, seedKind: ActiveStation["seedKind"], seedLabel: string) => {
      if (!enabled) return;
      const client = ensureClient();
      const readyStats = await client.load();
      rememberStylePopulations(readyStats.stylePopulations);
      // The launcher opens before the populations are read, so a fast tap reaches
      // a tile the disabled state had no counts to refuse yet. They are known
      // here, ahead of any compute, and a style with no members admits nothing
      // whether it is seeded by the style or filtered over Likes: refuse the
      // station rather than starting one that can only report itself empty.
      if (styleFilter !== null && !isStyleBitPopulated(readyStats.stylePopulations, styleFilter)) {
        setNotice("no-radio");
        return;
      }
      const shuffleSeed = randomSeed();
      const provider = buildProvider(seed, styleFilter, shuffleSeed);
      providerRef.current = provider;
      resetSidRadioStats();
      const started = performance.now();
      const { items } = await provider.refill(LOOKAHEAD);
      // `lastRefillMs` is end-to-end latency (it spans the await, so it includes
      // worker compute). `mainThreadMs` must NOT: its budget is one 60 fps frame
      // because it is meant to capture only the synchronous work this callback
      // does on the UI thread. Measuring it across the await made the two
      // identical and the budget meaningless — it read 113 ms against a 16 ms
      // bound while nothing was actually blocking the main thread.
      const settledAt = performance.now();
      recordRefill({
        lastRefillMs: settledAt - started,
        mainThreadMs: performance.now() - settledAt,
        emitted: items.length,
        lookahead: LOOKAHEAD,
        firstCandidate: true,
      });
      const snapshot = getRankingSnapshot();
      updateSidRadioStats({
        stationActive: items.length > 0,
        seedKind,
        styleBit: styleFilter,
        shuffleSeed,
        transportShuffleDisabled: items.length > 0,
        transportRepeatDisabled: items.length > 0,
      });
      if (items.length === 0) {
        providerRef.current = null;
        // Candidates resolve to a path through the md5→path index, which HVSC fills. An empty index
        // means nothing is installed, so NO station can produce a track whatever its seed — and the
        // usual wording then sends the user somewhere that cannot help: there is nothing installed
        // to like, and liking would not make a station playable. Name the real blocker. Once music
        // is installed, an empty station is a genuine one and keeps its taste/tune wording.
        if (getMd548PathIndexStats().size === 0) setNotice("no-hvsc");
        else setNotice(seedKind === "song" ? "no-radio-for-tune" : "no-radio");
        return;
      }
      setNotice(null);
      const activeStation: ActiveStation = {
        seedKind,
        seedLabel,
        styleBit: styleFilter,
        shuffleSeed,
        rankingSnapshotId: snapshot.id,
      };
      setStation(activeStation);
      persistSession(activeStation, seed);
      await startPlaylist(items);
    },
    [enabled, ensureClient, rememberStylePopulations, randomSeed, buildProvider, startPlaylist, persistSession],
  );

  const startSongRadio = useCallback(
    (md5_48: string, seedLabel: string) => start({ kind: "song", md5_48 }, null, "song", seedLabel),
    [start],
  );
  const startStyleRadio = useCallback(
    (styleBit: number, label: string, fromLikes = false) =>
      start(fromLikes ? { kind: "taste" } : { kind: "style", styleBit }, styleBit, "style", label),
    [start],
  );
  const startTasteRadio = useCallback(() => start({ kind: "taste" }, null, "taste", "Tunes you like"), [start]);
  const startSurpriseRadio = useCallback(async () => {
    const populations = await ensureStylePopulations();
    const candidates = SID_RADIO_STYLE_TILES.filter((tile) => isStylePopulated(populations, tile.key));
    if (candidates.length === 0) {
      setNotice("no-radio");
      return;
    }
    const tile = candidates[randomSeed() % candidates.length];
    await start({ kind: "style", styleBit: tile.bit }, tile.bit, "style", tile.label);
  }, [start, randomSeed, ensureStylePopulations]);

  const stop = useCallback(() => {
    setStation(null);
    providerRef.current = null;
    clearSidRadioSession();
    updateSidRadioStats({ stationActive: false, transportShuffleDisabled: false, transportRepeatDisabled: false });
  }, []);

  // Resume the chip after an app restart (D15): rebuild the provider with the
  // saved exclude set so the next refill continues the identical sequence.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !enabled || station) return;
    restoredRef.current = true;
    const saved: SidRadioSessionDescriptor | null = loadSidRadioSession();
    if (!saved) return;
    providerRef.current = buildProvider(
      saved.seed,
      saved.styleFilter,
      saved.shuffleSeed,
      saved.excludeOrdinals,
      resumeRecentOrdinals(saved, DEFAULT_STATION_BALANCE.recentWindow),
    );
    setStation({
      seedKind: saved.seedKind,
      seedLabel: saved.seedLabel,
      styleBit: saved.styleFilter,
      shuffleSeed: saved.shuffleSeed,
      rankingSnapshotId: saved.rankingSnapshotId,
    });
    updateSidRadioStats({
      stationActive: true,
      seedKind: saved.seedKind,
      styleBit: saved.styleFilter,
      shuffleSeed: saved.shuffleSeed,
      transportShuffleDisabled: true,
      transportRepeatDisabled: true,
    });
  }, [enabled, station, buildProvider]);

  const steer = useCallback(
    (md5: string, signal: RankingSignal) => {
      void setRanking(md5, signal);
      // Future refills pick up the new likes/notForMe (D8). ✕ also skips now.
      if (signal === "notForMe" && station) {
        const started = performance.now();
        params.advanceToNext?.();
        recordSkip(performance.now() - started);
      }
    },
    [station, params],
  );

  // Lookahead refill: when the cursor nears the tail, resolve + append more.
  useEffect(() => {
    if (!station || !providerRef.current) return;
    const remaining = playlistLength - currentIndex - 1;
    if (remaining > REFILL_THRESHOLD || refillingRef.current) return;
    refillingRef.current = true;
    const provider = providerRef.current;
    const started = performance.now();
    void provider
      .refill(LOOKAHEAD - remaining)
      .then(({ items, reason }) => {
        // See the note in the station-start refill: the awaited span is refill
        // *latency*, not main-thread occupancy. Only the synchronous work below
        // — appending items and saving the session — actually blocks the UI
        // thread, so that is what `mainThreadMs` has to measure.
        const settledAt = performance.now();
        if (items.length > 0) {
          appendItems(items);
          saveSidRadioSession({
            seedKind: station.seedKind,
            seedLabel: station.seedLabel,
            seed: seedRef.current.seed,
            styleFilter: station.styleBit,
            shuffleSeed: station.shuffleSeed,
            rankingSnapshotId: station.rankingSnapshotId,
            excludeOrdinals: provider.excludedOrdinals,
            recentOrdinals: provider.recentOrdinals,
          });
        } else if (reason) {
          updateSidRadioStats({ stationActive: true });
          // Say so. A station that runs out does it at the tail of the queue, which is exactly
          // where the user cannot tell an ended station from a broken one: playback stops on the
          // last track and Next does nothing, because there is no next. (Next stays *enabled*
          // whenever hold-to-seek is available, so it does not even grey out.) Observed on a Pixel
          // 4 — a Chill / Ambient station advertised as holding 17,574 tracks stopped dead after 25
          // and left no way to tell why. The provider latches this, so it will not resolve itself:
          // the station is over and picking another is the only way on.
          setNotice("station-ended");
        }
        recordRefill({
          lastRefillMs: settledAt - started,
          mainThreadMs: performance.now() - settledAt,
          emitted: items.length,
          lookahead: LOOKAHEAD,
        });
      })
      .finally(() => {
        refillingRef.current = false;
      });
  }, [station, currentIndex, playlistLength, appendItems]);

  // Record auto-advances for the continuity stat (§9.2). The determinism
  // sequence is recorded at emit time instead -- see `recordEmitted`.
  const lastIndexRef = useRef(currentIndex);
  useEffect(() => {
    if (station && currentIndex > lastIndexRef.current) {
      recordAutoAdvance();
    }
    lastIndexRef.current = currentIndex;
  }, [currentIndex, station]);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  return {
    active: station !== null,
    station,
    startSongRadio,
    startStyleRadio,
    startTasteRadio,
    startSurpriseRadio,
    stylePopulations,
    ensureStylePopulations,
    steer,
    stop,
    notice,
    dismissNotice: () => setNotice(null),
  };
};
