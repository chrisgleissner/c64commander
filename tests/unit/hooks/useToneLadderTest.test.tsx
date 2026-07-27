/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ladder measures the audio that arrives, so the one thing it cannot afford is to not be
 * listening. It shipped taking an OPTIONAL session with no default while `AvSyncPanel` renders
 * without a session prop, so `session?.subscribeAudio(...)` quietly did nothing: every run graded an
 * empty capture. It reported "not measured" rather than inventing numbers, which is why it looked
 * plausible — and why only running it on the phone exposed it.
 */

const { subscribeAudio, subscribeFrames, playSidUpload } = vi.hoisted(() => ({
  subscribeAudio: vi.fn(() => () => {}),
  subscribeFrames: vi.fn(() => () => {}),
  playSidUpload: vi.fn(async () => ({ errors: [] })),
}));

vi.mock("@/lib/streams/avMirrorSession", () => ({
  avMirrorSession: { subscribeAudio, subscribeFrames },
  AvMirrorSession: class {},
}));
vi.mock("@/lib/c64api", () => ({ getC64API: () => ({ playSidUpload }) }));

import { useToneLadderTest } from "@/hooks/useToneLadderTest";

describe("useToneLadderTest", () => {
  beforeEach(() => {
    subscribeAudio.mockClear();
    subscribeFrames.mockClear();
    playSidUpload.mockClear();
  });

  it("listens to the shared session when given none", async () => {
    const { result } = renderHook(() => useToneLadderTest());

    await act(async () => {
      await result.current.run();
    });

    expect(playSidUpload).toHaveBeenCalledTimes(1);
    expect(subscribeAudio).toHaveBeenCalledTimes(1);
    expect(subscribeFrames).toHaveBeenCalledTimes(1);
  });

  it("does not let a finished run's deadline cut short the next one", async () => {
    // A run usually ends early, when enough audio has arrived, leaving its deadline still pending.
    // Start another inside that window and the stale timer would fire against the new capture, which
    // then gets graded on a sliver of audio — a plausible-looking result from a measurement that
    // never happened.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useToneLadderTest());

      await act(async () => {
        await result.current.run();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
        await result.current.run();
      });

      // t=18.5s: past the FIRST run's deadline (18s) but before the second's (19s). If the stale
      // timer were still armed it would end the second run right here.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(17_500);
      });
      expect(result.current.running).toBe(true);

      // The second run's own deadline still ends it, at t=19s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(result.current.running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops listening once the run is reset", async () => {
    const unsubscribeAudio = vi.fn();
    subscribeAudio.mockReturnValueOnce(unsubscribeAudio);
    const { result } = renderHook(() => useToneLadderTest());

    await act(async () => {
      await result.current.run();
    });
    act(() => result.current.reset());

    // Leaving it subscribed would keep the Android audio bridge on after the measurement ended.
    expect(unsubscribeAudio).toHaveBeenCalled();
  });
});
