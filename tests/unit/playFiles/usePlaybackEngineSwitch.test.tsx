/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePlaybackEngine, type PlaybackEngine } from "@/lib/config/appSettings";
import {
  isRemotePlaybackActive,
  markRemotePlaybackStarted,
  markRemotePlaybackStopped,
} from "@/lib/playback/activePlaybackSession";
import type { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { usePlaybackEngineSwitch } from "@/pages/playFiles/hooks/usePlaybackEngineSwitch";
import type { PlaylistItem } from "@/pages/playFiles/types";

vi.mock("@/pages/playFiles/playableWithoutDevice", () => ({ isDeviceOutOfReach: () => false }));

const tune = { id: "tune", label: "Tune", category: "sid", path: "/Tune.sid", request: {} } as unknown as PlaylistItem;

/**
 * A C64 launch takes this long to reach the machine, during which the listener can choose again. The phone's
 * engine starts at once.
 */
const C64_LAUNCH_MS = 400;

const harness = (initialEngine: PlaybackEngine) => {
  savePlaybackEngine(initialEngine);
  let localSounding = initialEngine === "local";
  if (initialEngine === "c64") markRemotePlaybackStarted();
  let queue: Promise<void> = Promise.resolve();
  const enqueuePlayTransition = (task: () => Promise<void>) => {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const localEngine = {
    isActive: () => localSounding,
    stop: vi.fn(() => {
      localSounding = false;
    }),
  } as unknown as LocalSidPlaybackController;
  const currentPlaybackIsLocalRef = { current: localSounding };
  const playItem = vi.fn((_item: PlaylistItem) =>
    enqueuePlayTransition(async () => {
      if (localStorage.getItem("c64u_playback_engine") === "local") {
        localSounding = true;
        currentPlaybackIsLocalRef.current = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, C64_LAUNCH_MS));
      markRemotePlaybackStarted();
    }),
  );
  const stopOnC64 = vi.fn(async () => markRemotePlaybackStopped());
  renderHook(() =>
    usePlaybackEngineSwitch({
      selectedEngineRef: { current: initialEngine },
      currentPlaybackIsLocalRef,
      currentIndexRef: { current: 0 },
      playlistRef: { current: [tune] },
      isPlayingRef: { current: true },
      getLocalSidPlayback: () => localEngine,
      setCurrentPlaybackIsLocal: (isLocal) => {
        currentPlaybackIsLocalRef.current = isLocal;
      },
      enqueuePlayTransition,
      playItem,
      stopOnC64,
      onRestartFailed: vi.fn(),
    }),
  );
  const choose = (engine: PlaybackEngine) => {
    savePlaybackEngine(engine);
    window.dispatchEvent(new Event("c64u-app-settings-updated"));
  };
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(C64_LAUNCH_MS * 20);
    });
  };
  const wait = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  return { choose, settle, wait, playItem, stopOnC64, soundsHere: () => localSounding };
};

describe("usePlaybackEngineSwitch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    markRemotePlaybackStopped();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays only here after Here, C64 and Here again in quick succession", async () => {
    const h = harness("local");
    h.choose("c64");
    await h.wait(C64_LAUNCH_MS / 4);
    h.choose("local");
    await h.settle();

    expect(h.soundsHere()).toBe(true);
    expect(isRemotePlaybackActive()).toBe(false);
  });

  it("plays only on the C64 after C64, Here and C64 again in quick succession", async () => {
    const h = harness("c64");
    h.choose("local");
    await h.wait(C64_LAUNCH_MS / 4);
    h.choose("c64");
    await h.settle();

    expect(h.soundsHere()).toBe(false);
    expect(isRemotePlaybackActive()).toBe(true);
  });

  it("ends on the last choice after a burst of switches, starting the tune once", async () => {
    const h = harness("local");
    for (const engine of ["c64", "local", "c64", "local", "c64"] as const) {
      h.choose(engine);
      await h.wait(C64_LAUNCH_MS / 8);
    }
    await h.settle();

    expect(h.soundsHere()).toBe(false);
    expect(isRemotePlaybackActive()).toBe(true);
    expect(h.playItem).toHaveBeenCalledTimes(1);
  });

  it("does not restart a tune that a burst of switches leaves where it already plays", async () => {
    const h = harness("c64");
    h.choose("local");
    h.choose("c64");
    await h.settle();

    expect(h.playItem).not.toHaveBeenCalled();
    expect(h.stopOnC64).not.toHaveBeenCalled();
  });
});
