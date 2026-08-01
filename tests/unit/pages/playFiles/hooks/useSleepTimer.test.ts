/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSleepTimer } from "@/pages/playFiles/hooks/useSleepTimer";
import { SLEEP_TIMER_OFF } from "@/lib/playback/sleepTimer";

describe("useSleepTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops playback when a timed sleep timer runs out", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire, isPlaying: true }));

    act(() => result.current.setMode({ kind: "timed", minutes: 15, endsAtMs: Date.now() + 15 * 60_000 }));
    act(() => void vi.advanceTimersByTime(14 * 60_000));
    expect(onExpire).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(60_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    // Disarmed by firing, so the next tune started by hand is not stopped straight away.
    expect(result.current.mode).toEqual(SLEEP_TIMER_OFF);
  });

  it("fires once, not once per tick", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire, isPlaying: true }));
    act(() => result.current.setMode({ kind: "timed", minutes: 1, endsAtMs: Date.now() + 60_000 }));
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("stops at the end of the tune when that is what was asked for", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire, isPlaying: true }));
    act(() => result.current.setMode({ kind: "after-tune" }));

    // Time passing must not stop it mid-tune: this one waits for the tune, however long it is.
    act(() => void vi.advanceTimersByTime(60 * 60_000));
    expect(onExpire).not.toHaveBeenCalled();

    let stopped = false;
    act(() => {
      stopped = result.current.notifyTuneEnded();
    });
    // True tells the caller to stop rather than advance to the next tune.
    expect(stopped).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toEqual(SLEEP_TIMER_OFF);
  });

  it("lets a tune end normally when nothing is armed", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire, isPlaying: true }));
    let stopped = true;
    act(() => {
      stopped = result.current.notifyTuneEnded();
    });
    expect(stopped).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("does not leave 'after this tune' armed once playback has stopped anyway", () => {
    // Otherwise it lies in wait and cuts off the first tune of the next session.
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ isPlaying }: { isPlaying: boolean }) => useSleepTimer({ onExpire, isPlaying }),
      { initialProps: { isPlaying: true } },
    );
    act(() => result.current.setMode({ kind: "after-tune" }));
    rerender({ isPlaying: false });
    expect(result.current.mode).toEqual(SLEEP_TIMER_OFF);
  });

  it("runs no interval at all while it is off", () => {
    const setInterval = vi.spyOn(window, "setInterval");
    const { result } = renderHook(() => useSleepTimer({ onExpire: vi.fn(), isPlaying: true }));
    expect(setInterval).not.toHaveBeenCalled();
    // Nor for the kind that waits on a tune ending rather than on the clock.
    act(() => result.current.setMode({ kind: "after-tune" }));
    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });
});

describe("useSleepTimer double-fire guards", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stops once even if two track-end notifications arrive before the state settles", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire, isPlaying: true }));
    act(() => result.current.setMode({ kind: "after-tune" }));
    act(() => {
      result.current.notifyTuneEnded();
      result.current.notifyTuneEnded();
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
