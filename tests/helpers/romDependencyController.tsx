/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The playback controller wired the way the Play page wires it, for the tests of what it does with songs
 * that need the C64 ROMs. Each test file mocks the modules around it (see
 * `tests/unit/playFiles/usePlaybackController.romDependency.test.tsx`).
 */

import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { createPlaybackTimeStore, usePlaybackTime } from "@/pages/playFiles/playbackTimeStore";
import { useSoundingTune } from "@/pages/playFiles/hooks/useSoundingTune";
import { syntheticSid } from "./romDependencyFixture";

export const sidItem = (id: string, label: string, songNr: number, bytes: () => Uint8Array): PlaylistItem =>
  ({
    id,
    category: "sid",
    label,
    path: `/HVSC/${label}.sid`,
    durationMs: 60_000,
    subsongCount: 3,
    sourceId: null,
    sizeBytes: null,
    modifiedAt: null,
    addedAt: new Date(0).toISOString(),
    status: "ready",
    unavailableReason: null,
    request: {
      source: "local",
      path: `/HVSC/${label}.sid`,
      songNr,
      file: { name: `${label}.sid`, lastModified: 0, arrayBuffer: vi.fn(async () => bytes().slice().buffer) },
    },
  }) as unknown as PlaylistItem;

/** Listed by the fixture: the exact bytes of synthetic.sid. */
export const listed = (id: string, songNr: number, label = `Listed ${id}`) => sidItem(id, label, songNr, syntheticSid);
/** Not in the list: one more byte, so another MD5. */
export const plain = (id: string) => sidItem(id, `Plain ${id}`, 1, () => Uint8Array.from([...syntheticSid(), 0]));

/**
 * An RSID v2 whose header declares that it runs BASIC. With `listedBytes` it has the length the mocked MD5
 * maps to the fixture's listed file (so the list grades it); otherwise one more byte, so the list does not.
 */
export const basicRsidBytes = (listedBytes: boolean) => {
  const bytes = Uint8Array.from(listedBytes ? syntheticSid() : [...syntheticSid(), 0]);
  bytes.set([0x52, 0x53, 0x49, 0x44, 0, 2], 0);
  bytes[0x77] |= 2;
  return bytes;
};
export const basicRsid = (id: string, songNr = 1, listedBytes = false) =>
  sidItem(id, `BASIC ${id}`, songNr, () => basicRsidBytes(listedBytes));

/** A program: it needs the C64, so a playlist away from it moves past it. */
export const program = (id: string): PlaylistItem =>
  ({ ...sidItem(id, `Program ${id}`, 1, () => new Uint8Array(4)), category: "prg" }) as PlaylistItem;

export const fakeController = () => {
  let active = false;
  return {
    play: vi.fn(async () => {
      active = true;
      return { romRequired: false, started: true, sampleRate: 48000, channels: 2, tuneInfo: null };
    }),
    stop: vi.fn(() => {
      active = false;
    }),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    getStats: vi.fn(() => null),
    dispose: vi.fn(),
    warmLeadIn: vi.fn(),
    prerender: vi.fn(),
    isActive: vi.fn(() => active),
  };
};

export type ControllerOptions = {
  decide?: (item: PlaylistItem) => Promise<"play-anyway" | "cancel">;
  station?: boolean;
  currentIndex?: number;
  repeatOneEnabled?: boolean;
};

type Guard = { trackInstanceId: number; dueAtMs: number; autoFired: boolean; userCancelled: boolean };

export const renderController = (
  initialPlaylist: PlaylistItem[],
  controller: ReturnType<typeof fakeController>,
  options: ControllerOptions = {},
) =>
  renderHook(() => {
    const [playlist, setPlaylist] = useState(initialPlaylist);
    const [currentIndex, setCurrentIndex] = useState(options.currentIndex ?? 0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [playbackTime] = useState(createPlaybackTimeStore);
    const { playedMs } = usePlaybackTime(playbackTime);
    const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
    const [, setCurrentSubsongCount] = useState<number | null>(null);
    const [, setTrackInstanceId] = useState(0);
    const [autoAdvanceDueAtMs, setAutoAdvanceDueAtMs] = useState<number | null>(null);
    const playedClockRef = useRef({
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      reset: vi.fn(),
      current: vi.fn(() => playedMs),
    });
    const trackStartedAtRef = useRef<number | null>(null);
    const trackInstanceIdRef = useRef(0);
    const autoAdvanceGuardRef = useRef<Guard | null>(null);
    const playStartInFlightRef = useRef(false);
    const stationActiveRef = useRef(options.station === true);
    const enqueuePlayTransition = useCallback(async (task: () => Promise<void>) => task(), []);
    // As the Play page does it: a launch the listener asks for holds back the playing tune's auto-advance.
    const cancelAutoAdvance = useCallback(() => {
      if (!autoAdvanceGuardRef.current) return;
      autoAdvanceGuardRef.current.userCancelled = true;
      setAutoAdvanceDueAtMs(null);
    }, []);

    const api = usePlaybackController({
      playlist,
      setPlaylist,
      currentIndex,
      setCurrentIndex,
      isPlaying,
      setIsPlaying,
      isPaused,
      setIsPaused,
      setIsPlaylistLoading: vi.fn(),
      playbackTime,
      durationMs,
      setDurationMs,
      setCurrentSubsongCount,
      setTrackInstanceId,
      repeatEnabled: false,
      repeatOneEnabled: options.repeatOneEnabled === true,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
      deviceProduct: "C64 Ultimate",
      ensurePlaybackConnection: vi.fn().mockResolvedValue(undefined),
      resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(null),
      applySonglengthsToItems: vi.fn().mockImplementation(async (items) => items),
      restoreVolumeOverrides: vi.fn().mockResolvedValue(undefined),
      applyAudioMixerUpdates: vi.fn().mockResolvedValue(undefined),
      buildEnabledSidMuteUpdates: vi.fn().mockReturnValue({}),
      captureSidMuteSnapshot: vi.fn().mockReturnValue({ volumes: {}, enablement: {} }),
      snapshotToUpdates: vi.fn().mockReturnValue({}),
      resolveEnabledSidVolumeItems: vi.fn().mockResolvedValue([]),
      dispatchVolume: vi.fn(),
      sidEnablement: {} as never,
      pauseMuteSnapshotRef: { current: null },
      pausingFromPauseRef: { current: false },
      resumingFromPauseRef: { current: false },
      ensureUnmuted: vi.fn().mockResolvedValue(undefined),
      playedClockRef,
      trackStartedAtRef,
      ...useSoundingTune(),
      trackInstanceIdRef,
      autoAdvanceGuardRef,
      playStartInFlightRef,
      cancelAutoAdvance,
      enqueuePlayTransition,
      durationSeconds: 45,
      setAutoAdvanceDueAtMs,
      stationActiveRef,
      localSidPlaybackController: controller as never,
      resolveRomDependencyDecision: options.decide,
      trace: (fn: (...args: unknown[]) => unknown) => fn,
    } as never);

    return {
      ...api,
      playlist,
      currentIndex,
      isPlaying,
      isPaused,
      trackInstanceIdRef,
      autoAdvanceGuardRef,
      autoAdvanceDueAtMs,
      playedClockRef,
    };
  });

/** Run a play inside act and hand back what it threw, so the assertions that follow see settled mocks. */
export const attempt = async (run: () => Promise<unknown>): Promise<unknown> => {
  let caught: unknown;
  await act(async () => {
    try {
      await run();
    } catch (error) {
      caught = error;
    }
  });
  return caught;
};
