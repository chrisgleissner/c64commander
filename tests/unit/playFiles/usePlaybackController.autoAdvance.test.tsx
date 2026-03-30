/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { executePlayPlan } from "@/lib/playback/playbackRouter";

vi.mock("@/lib/archive/client", () => ({
    createArchiveClient: vi.fn(),
}));

vi.mock("@/lib/archive/execution", () => ({
    buildArchivePlayPlan: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
    getC64API: vi.fn(() => ({})),
}));

vi.mock("@/lib/playback/playbackRouter", () => ({
    buildPlayPlan: vi.fn((request) => request),
    executePlayPlan: vi.fn(async () => undefined),
    tryFetchUltimateSidBlob: vi.fn(async () => null),
}));

vi.mock("@/lib/hvsc", () => ({
    getHvscDurationByMd5Seconds: vi.fn(async () => null),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
    getSidSongCount: vi.fn(() => 1),
    computeSidMd5: vi.fn(async () => "mock-md5"),
}));

vi.mock("@/lib/logging", () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
    reportUserError: vi.fn(),
}));

vi.mock("@/lib/config/applyConfigFileReference", () => ({
    applyConfigFileReference: vi.fn(async () => undefined),
}));

const createPlaylistItem = (id: string, durationMs: number): PlaylistItem => ({
    id,
    request: {
        source: "ultimate",
        path: `/PROGRAMS/${id}.prg`,
    },
    category: "prg",
    label: `${id}.prg`,
    path: `/PROGRAMS/${id}.prg`,
    durationMs,
    sourceId: null,
    sizeBytes: null,
    modifiedAt: null,
    addedAt: new Date(0).toISOString(),
    status: "ready",
    unavailableReason: null,
});

const renderPlaybackHarness = (initialPlaylist: PlaylistItem[], options?: { repeatEnabled?: boolean }) =>
    renderHook(() => {
        const [playlist, setPlaylist] = useState(initialPlaylist);
        const [currentIndex, setCurrentIndex] = useState(0);
        const [isPlaying, setIsPlaying] = useState(false);
        const [isPaused, setIsPaused] = useState(false);
        const [elapsedMs, setElapsedMs] = useState(0);
        const [playedMs, setPlayedMs] = useState(0);
        const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
        const [currentSubsongCount, setCurrentSubsongCount] = useState<number | null>(null);
        const [trackInstanceId, setTrackInstanceId] = useState(0);
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
        const autoAdvanceGuardRef = useRef<{
            trackInstanceId: number;
            dueAtMs: number;
            autoFired: boolean;
            userCancelled: boolean;
        } | null>(null);
        const playStartInFlightRef = useRef(false);
        const cancelAutoAdvance = vi.fn(() => {
            autoAdvanceGuardRef.current = null;
            setAutoAdvanceDueAtMs(null);
        });
        const enqueuePlayTransition = useCallback(async (task: () => Promise<void>) => await task(), []);

        const controller = usePlaybackController({
            playlist,
            setPlaylist,
            currentIndex,
            setCurrentIndex,
            isPlaying,
            setIsPlaying,
            isPaused,
            setIsPaused,
            setIsPlaylistLoading: vi.fn(),
            elapsedMs,
            setElapsedMs,
            playedMs,
            setPlayedMs,
            durationMs,
            setDurationMs,
            setCurrentSubsongCount,
            setTrackInstanceId,
            repeatEnabled: options?.repeatEnabled ?? false,
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
            trackInstanceIdRef,
            autoAdvanceGuardRef,
            playStartInFlightRef,
            cancelAutoAdvance,
            enqueuePlayTransition,
            durationSeconds: 45,
            setAutoAdvanceDueAtMs,
            trace: (fn: (...args: unknown[]) => unknown) => fn,
        });

        return {
            ...controller,
            playlist,
            currentIndex,
            isPlaying,
            isPaused,
            durationMs,
            currentSubsongCount,
            trackInstanceId,
            autoAdvanceDueAtMs,
            autoAdvanceGuardRef,
            trackInstanceIdRef,
            cancelAutoAdvance,
        };
    });

describe("usePlaybackController auto advance", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("plays through a three-song playlist and stops after the final auto-advance when repeat is off", async () => {
        const playlist = [
            createPlaylistItem("one", 1_000),
            createPlaylistItem("two", 1_000),
            createPlaylistItem("three", 1_000),
        ];
        const { result } = renderPlaybackHarness(playlist);

        await act(async () => {
            await result.current.playItem(playlist[0], { playlistIndex: 0 });
        });
        expect(result.current.currentIndex).toBe(0);
        expect(result.current.isPlaying).toBe(true);

        await act(async () => {
            await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
        });
        expect(result.current.currentIndex).toBe(1);
        expect(result.current.isPlaying).toBe(true);

        await act(async () => {
            await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
        });
        expect(result.current.currentIndex).toBe(2);
        expect(result.current.isPlaying).toBe(true);

        await act(async () => {
            await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
        });

        expect(result.current.currentIndex).toBe(2);
        expect(result.current.isPlaying).toBe(false);
        expect(result.current.isPaused).toBe(false);
        expect(result.current.autoAdvanceGuardRef.current).toBeNull();
        expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(3);
    });

    it("wraps back to the first playlist item when repeat is enabled", async () => {
        const playlist = [
            createPlaylistItem("one", 1_000),
            createPlaylistItem("two", 1_000),
            createPlaylistItem("three", 1_000),
        ];
        const { result } = renderPlaybackHarness(playlist, { repeatEnabled: true });

        await act(async () => {
            await result.current.playItem(playlist[0], { playlistIndex: 0 });
        });
        await act(async () => {
            await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
        });
        await act(async () => {
            await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
        });
        await act(async () => {
            await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
        });

        expect(result.current.currentIndex).toBe(0);
        expect(result.current.isPlaying).toBe(true);
        expect(result.current.trackInstanceIdRef.current).toBe(4);
        expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(4);
    });
});
