/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { usePlaybackTimelineTicks } from "@/pages/playFiles/hooks/usePlaybackTimelineTicks";

const START_MS = 100_000;

const renderTicks = (options: { pageActive: boolean; autoAdvanceDueAtMs: number | null; running?: boolean }) => {
  let pageActive = options.pageActive;
  const tick = vi.fn();
  const startedAtRef = { current: START_MS - 2_300 };
  const rendered = renderHook(
    () =>
      usePlaybackTimelineTicks({
        tick,
        running: options.running ?? true,
        startedAtRef,
        autoAdvanceDueAtMs: options.autoAdvanceDueAtMs,
      }),
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ScreenActivityProvider active={pageActive}>{children}</ScreenActivityProvider>
      ),
    },
  );
  const setPageActive = (active: boolean) => {
    pageActive = active;
    rendered.rerender();
  };
  return { tick, setPageActive };
};

describe("usePlaybackTimelineTicks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks each second while the Play page is on screen", () => {
    const { tick } = renderTicks({ pageActive: true, autoAdvanceDueAtMs: START_MS + 60_000 });
    vi.advanceTimersByTime(3_100);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("does not re-render the timeline every second while another tab is on screen", () => {
    const { tick, setPageActive } = renderTicks({ pageActive: true, autoAdvanceDueAtMs: START_MS + 60_000 });
    vi.advanceTimersByTime(1_100);
    const ticksOnScreen = tick.mock.calls.length;
    setPageActive(false);
    vi.advanceTimersByTime(10_000);
    expect(tick).toHaveBeenCalledTimes(ticksOnScreen);
  });

  it("brings the timeline up to date at once when the Play page is shown again", () => {
    const { tick, setPageActive } = renderTicks({ pageActive: false, autoAdvanceDueAtMs: START_MS + 60_000 });
    vi.advanceTimersByTime(5_000);
    expect(tick).not.toHaveBeenCalled();
    setPageActive(true);
    vi.advanceTimersByTime(0);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenLastCalledWith(START_MS + 5_000);
  });

  it("still runs the timeline when the tune is due to end while another tab is on screen, so auto-advance happens", () => {
    const dueAtMs = START_MS + 7_000;
    const { tick } = renderTicks({ pageActive: false, autoAdvanceDueAtMs: dueAtMs });
    vi.advanceTimersByTime(6_999);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenLastCalledWith(dueAtMs);
    vi.advanceTimersByTime(10_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("runs the timeline at the moment the tune is due, not at the next second, while the Play page is on screen", () => {
    const dueAtMs = START_MS + 7_500;
    const { tick } = renderTicks({ pageActive: true, autoAdvanceDueAtMs: dueAtMs });
    vi.advanceTimersByTime(7_499);
    const ticksBeforeDue = tick.mock.calls.length;
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(ticksBeforeDue + 1);
    expect(tick).toHaveBeenLastCalledWith(dueAtMs);
  });

  it("schedules nothing at the due time when playback is not running", () => {
    const { tick } = renderTicks({ pageActive: true, autoAdvanceDueAtMs: START_MS + 2_500, running: false });
    vi.advanceTimersByTime(10_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
