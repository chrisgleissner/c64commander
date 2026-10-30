/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import type { PlaybackTimeline } from "@/pages/playFiles/playbackTimeline";
import { PlaybackTransport, type PlaybackTransportProps } from "@/pages/playFiles/components/PlaybackTransport";

const timeline: PlaybackTimeline = {
  playbackTime: createPlaybackTimeStore(),
  display: () => ({
    progressPercent: 50,
    elapsedLabel: "1:00",
    remainingLabel: "-1:00",
    totalLabel: "2:00",
    remainingTotalLabel: "2:00",
    playlistCountersShown: false,
  }),
};

const buildProps = (overrides: Partial<PlaybackTransportProps> = {}): PlaybackTransportProps => ({
  timeline,
  canTransport: true,
  hasPrev: true,
  hasNext: true,
  isPlaying: true,
  isPaused: false,
  hasPlaylist: true,
  isPlaylistLoading: false,
  canPause: true,
  onPrevious: vi.fn(),
  onPlay: vi.fn(),
  onStop: vi.fn(),
  onPauseResume: vi.fn(),
  onNext: vi.fn(),
  ...overrides,
});

afterEach(() => cleanup());

describe("PlaybackTransport hold to seek without scrubbing", () => {
  afterEach(() => {
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  it.each([
    ["playlist-prev", -5, "onPrevious"],
    ["playlist-next", 5, "onNext"],
  ] as const)(
    "seeks the engine directly from a held %s, repeating until release, and does not change track",
    (testId, delta, trackHandler) => {
      vi.useFakeTimers();
      const onSeek = vi.fn();
      const props = buildProps({ onSeek });
      render(<PlaybackTransport {...props} />);
      const button = screen.getByTestId(testId);

      fireEvent.pointerDown(button);
      act(() => vi.advanceTimersByTime(449));
      expect(onSeek).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(onSeek.mock.calls).toEqual([[delta]]);

      act(() => vi.advanceTimersByTime(400));
      expect(onSeek.mock.calls).toEqual([[delta], [delta], [delta]]);

      fireEvent.pointerUp(button);
      fireEvent.click(button);
      act(() => vi.advanceTimersByTime(1000));

      expect(onSeek).toHaveBeenCalledTimes(3);
      expect(props[trackHandler]).not.toHaveBeenCalled();
    },
  );

  it("changes track on press and starts no hold when seeking is unavailable", () => {
    vi.useFakeTimers();
    const props = buildProps();
    render(<PlaybackTransport {...props} />);
    const previous = screen.getByTestId("playlist-prev");

    fireEvent.pointerDown(previous);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerUp(previous);
    fireEvent.click(previous);

    expect(props.onPrevious).toHaveBeenCalledTimes(1);
  });
});

describe("PlaybackTransport seek bar", () => {
  it("seeks to the start rather than past the end when the bar has no width yet", () => {
    const onSeekToFraction = vi.fn();
    render(<PlaybackTransport {...buildProps({ onSeekToFraction })} />);
    const bar = screen.getByTestId("playback-progress-seek");
    bar.getBoundingClientRect = () => ({ left: 0, width: 0 }) as DOMRect;
    bar.setPointerCapture = vi.fn();

    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 50 });

    expect(onSeekToFraction).toHaveBeenCalledWith(0);
  });

  it.each([
    [true, "true"],
    [false, null],
  ])("marks the read-only progress bar as scrubbing only while scrubbing (%s)", (isScrubbing, expected) => {
    render(<PlaybackTransport {...buildProps({ isScrubbing })} />);

    const progress = screen.getByTestId("playback-progress");

    expect(screen.queryByTestId("playback-progress-seek")).toBeNull();
    expect(progress.getAttribute("data-scrubbing")).toBe(expected);
    expect(progress.classList.contains("ring-2")).toBe(isScrubbing);
  });
});
