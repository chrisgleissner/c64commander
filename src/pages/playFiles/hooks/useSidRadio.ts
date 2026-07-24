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
import { resolveVirtualPath } from "@/lib/sidRadio/md5PathIndex";
import {
  getNotForMeMd5s,
  getRankingSnapshot,
  getLikedMd5s,
  setRanking,
  type RankingSignal,
} from "@/lib/sidRadio/rankingStore";
import { SidRadioWorkerClient } from "@/lib/sidRadio/sidRadioWorkerClient";
import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import type { StationSeed } from "@/lib/sidRadio/stationEngine";
import {
  recordAutoAdvance,
  recordRefill,
  recordSkip,
  resetSidRadioStats,
  updateSidRadioStats,
} from "@/lib/sidRadio/sidRadioStats";

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
  steer: (md5: string, signal: RankingSignal) => void;
  stop: () => void;
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

/**
 * Orchestrates a SID Radio station (spec §6.1 `useSidRadio`): owns the worker
 * lifecycle + queue provider, produces `PlaylistItem`s into the **existing**
 * playback engine, keeps the queue refilled ahead of the cursor, and steers on
 * ♥/✕. A station is a *queue provider*, never a parallel transport (principle 1).
 */
export const useSidRadio = (params: UseSidRadioParams): UseSidRadioResult => {
  const { enabled, startPlaylist, appendItems, currentIndex, playlistLength } = params;
  const resolvePath = params.resolvePath ?? ((md5) => resolveVirtualPath(md5));
  const randomSeed = params.randomSeed ?? (() => Math.floor(Math.random() * 0xffffffff));

  const [station, setStation] = useState<ActiveStation | null>(null);
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

  const buildProvider = useCallback(
    (seed: StationSeed, styleFilter: number | null, shuffleSeed: number) => {
      const client = ensureClient();
      seedRef.current = { seed, styleFilter, shuffleSeed };
      return new StationQueueProvider({
        lookahead: LOOKAHEAD,
        computeCandidates: (exclude, count) =>
          client.compute({
            seed,
            styleFilter,
            shuffleSeed,
            likes: getLikedMd5s(),
            notForMe: getNotForMeMd5s(),
            exclude,
            count,
          }),
        resolvePath,
        buildItem: ({ virtualPath, songIndex, trackOrdinal }) =>
          buildStationItem({ virtualPath, songIndex, trackOrdinal }),
      });
    },
    [ensureClient, resolvePath],
  );

  const start = useCallback(
    async (seed: StationSeed, styleFilter: number | null, seedKind: ActiveStation["seedKind"], seedLabel: string) => {
      if (!enabled) return;
      const client = ensureClient();
      await client.load();
      const shuffleSeed = randomSeed();
      const provider = buildProvider(seed, styleFilter, shuffleSeed);
      providerRef.current = provider;
      resetSidRadioStats();
      const started = performance.now();
      const { items } = await provider.refill(LOOKAHEAD);
      recordRefill({
        lastRefillMs: performance.now() - started,
        mainThreadMs: performance.now() - started,
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
        return;
      }
      setStation({ seedKind, seedLabel, styleBit: styleFilter, shuffleSeed, rankingSnapshotId: snapshot.id });
      await startPlaylist(items);
    },
    [enabled, ensureClient, randomSeed, buildProvider, startPlaylist],
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
  const startSurpriseRadio = useCallback(() => {
    const bit = Math.floor(randomSeed() % 9);
    const labels = [
      "Fast-Paced",
      "Chill / Ambient",
      "Melodic",
      "Experimental",
      "Nostalgic",
      "Composer Deep-Dive",
      "Era Explorer",
      "Deep Cuts",
      "Game Themes",
    ];
    return start({ kind: "style", styleBit: bit }, bit, "style", labels[bit] ?? "Surprise");
  }, [start, randomSeed]);

  const stop = useCallback(() => {
    setStation(null);
    providerRef.current = null;
    updateSidRadioStats({ stationActive: false, transportShuffleDisabled: false, transportRepeatDisabled: false });
  }, []);

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
        const mainThreadMs = performance.now() - started;
        recordRefill({ lastRefillMs: mainThreadMs, mainThreadMs, emitted: items.length, lookahead: LOOKAHEAD });
        if (items.length > 0) {
          appendItems(items);
        } else if (reason) {
          updateSidRadioStats({ stationActive: true });
        }
      })
      .finally(() => {
        refillingRef.current = false;
      });
  }, [station, currentIndex, playlistLength, appendItems]);

  // Record auto-advances for the continuity/determinism stats (§9.2).
  const lastIndexRef = useRef(currentIndex);
  useEffect(() => {
    if (station && currentIndex > lastIndexRef.current) {
      recordAutoAdvance(currentIndex);
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
    steer,
    stop,
  };
};

/** The 9 style tiles (spec §5.4) — mask bit → friendly label + blurb. */
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
