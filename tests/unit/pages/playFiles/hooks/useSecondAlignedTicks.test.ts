/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { msUntilNextSecond, useSecondAlignedTicks } from "@/pages/playFiles/hooks/useSecondAlignedTicks";

describe("msUntilNextSecond", () => {
  it("waits a whole second while the track has no start", () => {
    expect(msUntilNextSecond(null, 5_000)).toBe(1000);
  });

  it("lands just after the next second of the track's elapsed time", () => {
    expect(msUntilNextSecond(10_000, 12_300)).toBe(705);
    expect(msUntilNextSecond(10_000, 12_000)).toBe(5);
  });

  it("aims at the second about to turn, and past one that has just been shown", () => {
    expect(msUntilNextSecond(10_000, 12_990)).toBe(15);
    expect(msUntilNextSecond(10_000, 12_005)).toBe(1000);
  });

  it("follows a start in the future, which a rebase onto a later position produces", () => {
    expect(msUntilNextSecond(13_250, 12_000)).toBe(255);
  });
});

describe("useSecondAlignedTicks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Where in its second each tick's shown moment falls, and when each tick actually ran. */
  const ticksOf = (startedAt: { current: number | null }, renderMs = 0) => {
    const shown: number[] = [];
    const ran: number[] = [];
    const tick = vi.fn((shownAtMs: number) => {
      shown.push((shownAtMs - (startedAt.current ?? 0)) % 1000);
      ran.push((((Date.now() - (startedAt.current ?? 0)) % 1000) + 1000) % 1000);
      vi.setSystemTime(Date.now() + renderMs);
    });
    return { shown, ran, tick };
  };

  it("ticks at once, then as each second of elapsed time turns rather than once a second at any phase", () => {
    const startedAt = { current: 100_000 - 2_300 };
    const { shown, tick } = ticksOf(startedAt);
    renderHook(() => useSecondAlignedTicks(tick, true, startedAt));
    vi.advanceTimersByTime(3_100);
    expect(shown).toEqual([300, 5, 5, 5]);
  });

  it("starts a slow render early enough that the new second appears as it turns", () => {
    const startedAt = { current: 100_000 - 2_300 };
    const { shown, ran, tick } = ticksOf(startedAt, 60);
    renderHook(() => useSecondAlignedTicks(tick, true, startedAt));
    vi.advanceTimersByTime(12_000);
    expect(shown.slice(1).every((phase) => phase === 5)).toBe(true);
    // The measured render time converges on 60 ms, so the tick runs about that long before the second.
    expect(ran.at(-1)).toBeGreaterThanOrEqual(940);
    expect(ran.at(-1)).toBeLessThanOrEqual(950);
    const seconds = tick.mock.calls.map(([shownAtMs]) => Math.floor((shownAtMs - startedAt.current) / 1000));
    expect(seconds).toEqual(seconds.map((_, index) => seconds[0] + index));
  });

  it("follows a rebase of the track's start, so the ticks stay on the new seconds", () => {
    const startedAt = { current: 100_000 };
    const { shown, tick } = ticksOf(startedAt);
    renderHook(() => useSecondAlignedTicks(tick, true, startedAt));
    vi.advanceTimersByTime(1_100);
    startedAt.current = Date.now() - 400;
    vi.advanceTimersByTime(2_000);
    expect(shown.slice(-2)).toEqual([5, 5]);
  });

  it("renders its first tick outside React's commit, where flushSync cannot render", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    onTestFinished(() => errors.mockRestore());
    const startedAt = { current: 100_000 };
    renderHook(() => useSecondAlignedTicks(vi.fn(), true, startedAt));
    vi.advanceTimersByTime(1_000);
    expect(errors.mock.calls.flat().join(" ")).not.toContain("flushSync");
  });

  it("does nothing while disabled, and stops when unmounted", () => {
    const startedAt = { current: 100_000 };
    const tick = vi.fn();
    const { rerender, unmount } = renderHook(({ enabled }) => useSecondAlignedTicks(tick, enabled, startedAt), {
      initialProps: { enabled: false },
    });
    vi.advanceTimersByTime(3_000);
    expect(tick).not.toHaveBeenCalled();
    rerender({ enabled: true });
    vi.advanceTimersByTime(0);
    expect(tick).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(3_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
