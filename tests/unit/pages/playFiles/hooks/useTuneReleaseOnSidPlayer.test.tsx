/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: "REAL_CONNECTED" }),
}));

import { releaseDeviceForSidPlayer } from "@/lib/appMode/deviceRelease";
import {
  isRemotePlaybackActive,
  markRemotePlaybackStarted,
  markRemotePlaybackStopped,
} from "@/lib/playback/activePlaybackSession";
import { useTuneReleaseOnSidPlayer } from "@/pages/playFiles/hooks/useTuneReleaseOnSidPlayer";

describe("useTuneReleaseOnSidPlayer", () => {
  beforeEach(() => markRemotePlaybackStopped());

  it("SPM-MODE-02 stops a tune playing on the C64 without ending the launch mounts, and records it as stopped", async () => {
    markRemotePlaybackStarted();
    const stopTuneOnC64 = vi.fn(async () => undefined);
    renderHook(() => useTuneReleaseOnSidPlayer({ isPausedRef: { current: false }, stopTuneOnC64 }));

    await releaseDeviceForSidPlayer();

    expect(stopTuneOnC64).toHaveBeenCalledTimes(1);
    expect(stopTuneOnC64).toHaveBeenCalledWith(expect.anything(), false, undefined, false);
    expect(isRemotePlaybackActive()).toBe(false);
  });

  it("SPM-MODE-02 stops a paused machine even when no tune is recorded as playing", async () => {
    const stopTuneOnC64 = vi.fn(async () => undefined);
    renderHook(() => useTuneReleaseOnSidPlayer({ isPausedRef: { current: true }, stopTuneOnC64 }));

    await releaseDeviceForSidPlayer();

    expect(stopTuneOnC64).toHaveBeenCalledTimes(1);
  });

  it("SPM-MODE-02 leaves the machine alone when nothing plays on it", async () => {
    const stopTuneOnC64 = vi.fn(async () => undefined);
    renderHook(() => useTuneReleaseOnSidPlayer({ isPausedRef: { current: false }, stopTuneOnC64 }));

    await releaseDeviceForSidPlayer();

    expect(stopTuneOnC64).not.toHaveBeenCalled();
  });

  it("SPM-MODE-02 records the tune as stopped even when stopping it fails", async () => {
    markRemotePlaybackStarted();
    const stopTuneOnC64 = vi.fn(async () => {
      throw new Error("device did not answer");
    });
    renderHook(() => useTuneReleaseOnSidPlayer({ isPausedRef: { current: false }, stopTuneOnC64 }));

    await releaseDeviceForSidPlayer();

    expect(isRemotePlaybackActive()).toBe(false);
  });

  it("SPM-MODE-02 stops registering when the page unmounts", async () => {
    markRemotePlaybackStarted();
    const stopTuneOnC64 = vi.fn(async () => undefined);
    const { unmount } = renderHook(() => useTuneReleaseOnSidPlayer({ isPausedRef: { current: false }, stopTuneOnC64 }));
    unmount();

    await releaseDeviceForSidPlayer();

    expect(stopTuneOnC64).not.toHaveBeenCalled();
  });
});
