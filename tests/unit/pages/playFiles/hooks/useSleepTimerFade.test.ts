/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addLog } from "@/lib/logging";
import type { PlaybackRoute } from "@/lib/playback/playbackEngineRouting";
import { SLEEP_TIMER_OFF, type SleepTimerMode } from "@/lib/playback/sleepTimer";
import { fadedVolumeIndex, SLEEP_TIMER_FADE_MS } from "@/lib/playback/sleepTimerFade";
import { useSleepTimerFade } from "@/pages/playFiles/hooks/useSleepTimerFade";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const T0 = 1_000_000;
const timed = (endsAtMs: number): SleepTimerMode => ({ kind: "timed", endsAtMs, minutes: 15 });

const makeBinding = (
  overrides: Partial<{ volumeIndex: number; volumeMuted: boolean; canControlVolume: boolean }> = {},
) => ({
  volumeIndex: 20,
  volumeMuted: false,
  canControlVolume: true,
  onVolumeDraftChange: vi.fn(),
  onVolumePreview: vi.fn(),
  onVolumeCommit: vi.fn(),
  ...overrides,
});

type Props = { mode: SleepTimerMode; playing: boolean; route: PlaybackRoute; binding: ReturnType<typeof makeBinding> };

const renderFade = (props: Props) => renderHook((p: Props) => useSleepTimerFade(p), { initialProps: props });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("fadedVolumeIndex", () => {
  it("falls linearly to 0 at the deadline from wherever the fade began", () => {
    expect(fadedVolumeIndex(20, 0, 10_000, 0)).toBe(20);
    expect(fadedVolumeIndex(20, 0, 10_000, 5_000)).toBe(10);
    expect(fadedVolumeIndex(20, 0, 10_000, 10_000)).toBe(0);
    expect(fadedVolumeIndex(20, 7_000, 10_000, 7_000)).toBe(20);
    expect(fadedVolumeIndex(20, 7_000, 10_000, 8_500)).toBe(10);
  });
});

describe("useSleepTimerFade", () => {
  it("leaves the volume alone until the fade window and then lowers it to the floor by the deadline", () => {
    const binding = makeBinding();
    const endsAt = T0 + 60_000;
    renderFade({ mode: timed(endsAt), playing: true, route: "local", binding });

    act(() => vi.advanceTimersByTime(60_000 - SLEEP_TIMER_FADE_MS - 1_000));
    expect(binding.onVolumePreview).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SLEEP_TIMER_FADE_MS + 1_000 - 250));
    const previews = binding.onVolumePreview.mock.calls.map(([index]) => index as number);
    expect(previews.length).toBeGreaterThan(10);
    expect(previews).toEqual([...previews].sort((a, b) => b - a));
    expect(previews.at(-1)).toBeLessThanOrEqual(1);
    expect(binding.onVolumeCommit).not.toHaveBeenCalled();
  });

  it("puts the listener's level back when the timer is switched off during the fade", () => {
    const binding = makeBinding();
    const endsAt = T0 + 20_000;
    const view = renderFade({ mode: timed(endsAt), playing: true, route: "c64", binding });
    act(() => vi.advanceTimersByTime(15_000));
    expect(binding.onVolumePreview).toHaveBeenCalled();

    view.rerender({ mode: SLEEP_TIMER_OFF, playing: true, route: "c64", binding });

    expect(binding.onVolumeCommit).toHaveBeenCalledTimes(1);
    expect(binding.onVolumeCommit).toHaveBeenCalledWith(20);
  });

  it("puts the listener's level back when the timer is extended during the fade", () => {
    const binding = makeBinding();
    const view = renderFade({ mode: timed(T0 + 20_000), playing: true, route: "local", binding });
    act(() => vi.advanceTimersByTime(15_000));

    view.rerender({ mode: timed(T0 + 20_000 + 15 * 60_000), playing: true, route: "local", binding });

    expect(binding.onVolumeCommit).toHaveBeenCalledWith(20);
  });

  it("restores on-device volume after the stop, and leaves the C64 mixer to the volume session", () => {
    const local = makeBinding();
    const localView = renderFade({ mode: timed(T0 + 12_000), playing: true, route: "local", binding: local });
    act(() => vi.advanceTimersByTime(11_000));
    act(() => localView.result.current.finishAfterStop());
    expect(local.onVolumeCommit).toHaveBeenCalledWith(20);

    vi.setSystemTime(T0);
    const device = makeBinding();
    const deviceView = renderFade({ mode: timed(T0 + 12_000), playing: true, route: "c64", binding: device });
    act(() => vi.advanceTimersByTime(11_000));
    act(() => deviceView.result.current.finishAfterStop());
    expect(device.onVolumeCommit).not.toHaveBeenCalled();
    expect(device.onVolumeDraftChange).toHaveBeenLastCalledWith(20);
  });

  it("does not fade while nothing is playing, or while muted", () => {
    const paused = makeBinding();
    renderFade({ mode: timed(T0 + 12_000), playing: false, route: "local", binding: paused });
    const muted = makeBinding({ volumeMuted: true });
    renderFade({ mode: timed(T0 + 12_000), playing: true, route: "local", binding: muted });

    act(() => vi.advanceTimersByTime(11_000));

    expect(paused.onVolumePreview).not.toHaveBeenCalled();
    expect(muted.onVolumePreview).not.toHaveBeenCalled();
  });
  it.each([new Error("preview unavailable"), "preview unavailable"])(
    "logs a rejected volume preview with error context (%s) and continues fading",
    async (error) => {
      const binding = makeBinding();
      binding.onVolumePreview.mockRejectedValueOnce(error);
      renderFade({ mode: timed(T0 + 10_000), playing: true, route: "local", binding });
      await act(async () => vi.advanceTimersByTime(1_000));
      expect(addLog).toHaveBeenCalledWith("warn", "Sleep timer fade: lowering the volume failed", {
        error: "preview unavailable",
        stack: error instanceof Error ? error.stack : undefined,
      });
      expect(binding.onVolumeDraftChange).toHaveBeenLastCalledWith(18);
      await act(async () => vi.advanceTimersByTime(1_000));
      expect(binding.onVolumePreview).toHaveBeenLastCalledWith(16);
    },
  );

  it("logs a rejected restore when the deadline changes and does not retry the abandoned fade", async () => {
    const binding = makeBinding();
    const error = new Error("restore unavailable");
    binding.onVolumeCommit.mockRejectedValueOnce(error);
    const view = renderFade({ mode: timed(T0 + 10_000), playing: true, route: "local", binding });
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(binding.onVolumePreview).toHaveBeenLastCalledWith(10);
    await act(async () => {
      view.rerender({ mode: timed(T0 + 900_000), playing: true, route: "local", binding });
    });
    expect(binding.onVolumeCommit).toHaveBeenCalledExactlyOnceWith(20);
    expect(addLog).toHaveBeenCalledWith("warn", "Sleep timer fade: restoring the volume failed", {
      error: error.message,
      stack: error.stack,
    });
    act(() => view.result.current.finishAfterStop());
    expect(binding.onVolumeCommit).toHaveBeenCalledTimes(1);
  });
});
