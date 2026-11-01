/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setNowPlaying: vi.fn(async (_info: unknown, _context: unknown) => undefined),
  setPosition: vi.fn(async (_info: unknown, _context: unknown) => undefined),
  reportUserError: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  setBackgroundExecutionNowPlaying: mocks.setNowPlaying,
  setBackgroundExecutionPosition: mocks.setPosition,
}));
vi.mock("@/lib/uiErrors", () => ({ reportUserError: mocks.reportUserError }));
vi.mock("@/lib/logging", () => ({ addLog: mocks.addLog }));

import { lockScreenSeekChannel } from "@/lib/input/lockScreenSeekChannel";
import { useLockScreenPlayback } from "@/pages/playFiles/hooks/useLockScreenPlayback";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";

type Props = Parameters<typeof useLockScreenPlayback>[0];

const baseProps = (overrides: Partial<Props> = {}): Props => ({
  title: "Nightshift",
  artist: "Jeroen Tel",
  durationMs: 180_000,
  tuneNumber: 1,
  tuneCount: 1,
  trackInstanceId: 1,
  playing: true,
  playbackTime: createPlaybackTimeStore({ elapsedMs: 0, playedMs: 0 }),
  onSeekToFraction: vi.fn(),
  ...overrides,
});

const positions = () => mocks.setPosition.mock.calls.map(([info]) => info);

const tick = async (store: Props["playbackTime"], elapsedMs: number, advanceWallMs: number) => {
  vi.setSystemTime(Date.now() + advanceWallMs);
  await act(async () => {
    store.setElapsedMs(elapsedMs);
    await Promise.resolve();
  });
};

describe("useLockScreenPlayback", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    mocks.setNowPlaying.mockClear().mockResolvedValue(undefined);
    mocks.setPosition.mockClear().mockResolvedValue(undefined);
    mocks.reportUserError.mockClear();
    mocks.addLog.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("now playing (QW-LS-04)", () => {
    it("names the tune within a file that holds several as the album", () => {
      renderHook(() => useLockScreenPlayback(baseProps({ tuneNumber: 3, tuneCount: 19 })));

      expect(mocks.setNowPlaying).toHaveBeenCalledWith(
        { title: "Nightshift", artist: "Jeroen Tel", durationMs: 180_000, album: "Tune 3 of 19" },
        expect.objectContaining({ source: "playback-controller", reason: "now-playing" }),
      );
    });

    it("leaves the album out for a file with one tune", () => {
      renderHook(() => useLockScreenPlayback(baseProps()));

      expect(mocks.setNowPlaying).toHaveBeenCalledWith(expect.objectContaining({ album: null }), expect.anything());
    });

    it("publishes again on a new subsong of the same file", () => {
      const { rerender } = renderHook((props: Props) => useLockScreenPlayback(props), {
        initialProps: baseProps({ tuneNumber: 3, tuneCount: 19, trackInstanceId: 1 }),
      });
      rerender(baseProps({ tuneNumber: 4, tuneCount: 19, trackInstanceId: 2 }));

      expect(mocks.setNowPlaying).toHaveBeenLastCalledWith(
        expect.objectContaining({ album: "Tune 4 of 19" }),
        expect.anything(),
      );
    });

    it("reports a failed publish as background diagnostics, never a toast", async () => {
      mocks.setNowPlaying.mockRejectedValueOnce(new Error("bridge gone"));
      renderHook(() => useLockScreenPlayback(baseProps({ trackInstanceId: 7 })));
      await vi.waitFor(() => expect(mocks.reportUserError).toHaveBeenCalled());

      expect(mocks.reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "setBackgroundExecutionNowPlaying",
          background: true,
          context: { trackInstanceId: 7 },
        }),
      );
    });
  });

  describe("position (QW-LS-02)", () => {
    it("publishes where playback starts, with the seek bar enabled", () => {
      const props = baseProps({ playbackTime: createPlaybackTimeStore({ elapsedMs: 4_000, playedMs: 0 }) });
      renderHook(() => useLockScreenPlayback(props));

      expect(positions()).toEqual([{ positionMs: 4_000, playing: true, seekable: true }]);
    });

    it("publishes nothing on the clock's own ticks: Android advances the marker itself", async () => {
      const props = baseProps();
      renderHook(() => useLockScreenPlayback(props));
      mocks.setPosition.mockClear();

      for (let second = 1; second <= 60; second += 1) {
        await tick(props.playbackTime, second * 1_000, 1_000);
      }

      expect(mocks.setPosition).not.toHaveBeenCalled();
    });

    it("publishes the frozen position on pause and the running one on resume", async () => {
      const props = baseProps();
      const { rerender } = renderHook((p: Props) => useLockScreenPlayback(p), { initialProps: props });
      await tick(props.playbackTime, 10_000, 10_000);
      mocks.setPosition.mockClear();

      rerender({ ...props, playing: false });
      await tick(props.playbackTime, 10_000, 30_000);
      rerender({ ...props, playing: true });

      expect(positions()).toEqual([
        { positionMs: 10_000, playing: false, seekable: true },
        { positionMs: 10_000, playing: true, seekable: true },
      ]);
    });

    it("publishes once after a seek lands, whichever engine made it", async () => {
      const props = baseProps();
      renderHook(() => useLockScreenPlayback(props));
      await tick(props.playbackTime, 5_000, 5_000);
      mocks.setPosition.mockClear();

      await tick(props.playbackTime, 120_000, 1_000);
      await tick(props.playbackTime, 121_000, 1_000);
      await tick(props.playbackTime, 122_000, 1_000);

      expect(positions()).toEqual([{ positionMs: 120_000, playing: true, seekable: true }]);
    });

    it("publishes a seek made while paused", async () => {
      const props = baseProps({ playing: false });
      renderHook(() => useLockScreenPlayback(props));
      mocks.setPosition.mockClear();

      await tick(props.playbackTime, 60_000, 500);

      expect(positions()).toEqual([{ positionMs: 60_000, playing: false, seekable: true }]);
    });

    it("publishes when the length becomes known or changes", () => {
      const props = baseProps({ durationMs: null });
      const { rerender } = renderHook((p: Props) => useLockScreenPlayback(p), { initialProps: props });
      mocks.setPosition.mockClear();

      rerender({ ...props, durationMs: 180_000 });
      rerender({ ...props, durationMs: 200_000 });
      rerender({ ...props, durationMs: 200_000 });

      expect(mocks.setPosition).toHaveBeenCalledTimes(2);
    });

    it("publishes a new tune's start, and that the bar is no longer seekable", () => {
      const props = baseProps();
      const { rerender } = renderHook((p: Props) => useLockScreenPlayback(p), { initialProps: props });
      mocks.setPosition.mockClear();

      rerender({ ...props, trackInstanceId: 2, onSeekToFraction: undefined });

      expect(positions()).toEqual([{ positionMs: 0, playing: true, seekable: false }]);
    });

    it("does not publish again when only the seek handler's identity changes", () => {
      const props = baseProps();
      const { rerender } = renderHook((p: Props) => useLockScreenPlayback(p), { initialProps: props });
      mocks.setPosition.mockClear();

      rerender({ ...props, onSeekToFraction: vi.fn() });
      rerender({ ...props, onSeekToFraction: vi.fn() });

      expect(mocks.setPosition).not.toHaveBeenCalled();
    });

    it("reports a failed publish as background diagnostics", async () => {
      mocks.setPosition.mockRejectedValueOnce(new Error("bridge gone"));
      renderHook(() => useLockScreenPlayback(baseProps({ trackInstanceId: 9 })));
      await vi.waitFor(() => expect(mocks.reportUserError).toHaveBeenCalled());

      expect(mocks.reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "setBackgroundExecutionPosition",
          background: true,
          context: expect.objectContaining({ trackInstanceId: 9 }),
        }),
      );
    });
  });

  describe("seek requests (QW-LS-03)", () => {
    it("turns the requested position into a fraction of the tune and seeks there", () => {
      const onSeekToFraction = vi.fn();
      renderHook(() => useLockScreenPlayback(baseProps({ onSeekToFraction })));

      lockScreenSeekChannel.publish(45_000);

      expect(onSeekToFraction).toHaveBeenCalledWith(0.25);
    });

    it("uses the seek handler of the latest render", () => {
      const first = vi.fn();
      const second = vi.fn();
      const props = baseProps({ onSeekToFraction: first });
      const { rerender } = renderHook((p: Props) => useLockScreenPlayback(p), { initialProps: props });
      rerender({ ...props, onSeekToFraction: second });

      lockScreenSeekChannel.publish(90_000);

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(0.5);
    });

    it("drops and logs a request for a tune that cannot be seeked", () => {
      renderHook(() => useLockScreenPlayback(baseProps({ onSeekToFraction: undefined })));

      lockScreenSeekChannel.publish(45_000);

      expect(mocks.addLog).toHaveBeenCalledWith(
        "warn",
        "Ignored a lock-screen seek: this tune cannot be seeked",
        expect.objectContaining({ positionMs: 45_000 }),
      );
    });

    it("drops and logs a request when the tune has no length", () => {
      const onSeekToFraction = vi.fn();
      renderHook(() => useLockScreenPlayback(baseProps({ onSeekToFraction, durationMs: null })));

      lockScreenSeekChannel.publish(45_000);

      expect(onSeekToFraction).not.toHaveBeenCalled();
      expect(mocks.addLog).toHaveBeenCalledWith(
        "warn",
        "Ignored a lock-screen seek: this tune cannot be seeked",
        expect.anything(),
      );
    });

    it("stops listening when the page unmounts, so a late request is dropped rather than replayed", () => {
      const onSeekToFraction = vi.fn();
      const { unmount } = renderHook(() => useLockScreenPlayback(baseProps({ onSeekToFraction })));
      unmount();

      lockScreenSeekChannel.publish(45_000);

      expect(onSeekToFraction).not.toHaveBeenCalled();
      expect(mocks.addLog).toHaveBeenCalledWith(
        "warn",
        expect.stringContaining("Dropped a lock-screen seek request"),
        expect.anything(),
      );
    });
  });
});
