/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createPlaybackTimeStore,
  usePlaybackTime,
  usePlaybackTimeEffect,
  type PlaybackTime,
} from "@/pages/playFiles/playbackTimeStore";
import { describePlaybackTime, usePlaybackTimeline } from "@/pages/playFiles/playbackTimeline";

describe("playback time store", () => {
  it("tells its listeners about a change, not about a set to the value it already holds", () => {
    const store = createPlaybackTimeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setElapsedMs(1_000);
    store.setElapsedMs(1_000);
    store.setPlayedMs(2_000);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.read()).toEqual({ elapsedMs: 1_000, playedMs: 2_000 });
    unsubscribe();
    store.setElapsedMs(3_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("re-renders a component that shows the time when it moves", () => {
    const store = createPlaybackTimeStore({ elapsedMs: 5_000, playedMs: 0 });
    const { result } = renderHook(() => usePlaybackTime(store));
    expect(result.current.elapsedMs).toBe(5_000);

    act(() => store.setElapsedMs(6_000));

    expect(result.current.elapsedMs).toBe(6_000);
  });

  it("reports elapsed and played time set together once, after the code that set them", async () => {
    const store = createPlaybackTimeStore();
    const seen: PlaybackTime[] = [];
    const onTime = (time: PlaybackTime) => seen.push(time);
    const { unmount } = renderHook(() => usePlaybackTimeEffect(store, onTime));
    expect(seen).toEqual([{ elapsedMs: 0, playedMs: 0 }]);

    store.setElapsedMs(1_000);
    store.setPlayedMs(1_000);
    expect(seen).toHaveLength(1);
    await Promise.resolve();

    expect(seen).toEqual([
      { elapsedMs: 0, playedMs: 0 },
      { elapsedMs: 1_000, playedMs: 1_000 },
    ]);
    store.setElapsedMs(2_000);
    unmount();
    await Promise.resolve();
    expect(seen).toHaveLength(2);
  });
});

describe("describePlaybackTime", () => {
  const inputs = {
    durationMs: 120_000,
    launching: false,
    scrubTargetMs: null,
    heldAtMs: undefined,
    playlistTotalsAt: (elapsedMs: number) => ({ total: 300_000, remaining: 300_000 - elapsedMs }),
  };

  it("shows the remaining time of the tune and of the playlist from the shown position", () => {
    expect(describePlaybackTime(inputs, 30_000)).toEqual({
      progressPercent: 25,
      elapsedLabel: "0:30",
      remainingLabel: "-1:30",
      totalLabel: "5:00",
      remainingTotalLabel: "4:30",
    });
  });

  it("shows no remaining time for a tune of unknown length", () => {
    expect(describePlaybackTime({ ...inputs, durationMs: undefined }, 30_000)).toMatchObject({
      progressPercent: 0,
      remainingLabel: "—",
    });
  });

  it("works the display out once for every label shown at one elapsed time", () => {
    const playlistTotalsAt = vi.fn(inputs.playlistTotalsAt);
    const store = createPlaybackTimeStore();
    const { result } = renderHook(() => usePlaybackTimeline(store, { ...inputs, playlistTotalsAt }));

    const first = result.current.display(30_000);
    expect(result.current.display(30_000)).toBe(first);
    expect(playlistTotalsAt).toHaveBeenCalledTimes(1);
    result.current.display(31_000);
    expect(playlistTotalsAt).toHaveBeenCalledTimes(2);
  });
});
