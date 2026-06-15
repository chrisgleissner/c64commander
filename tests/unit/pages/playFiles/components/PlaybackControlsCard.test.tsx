/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CTA_HIGHLIGHT_DURATION_MS, CTA_PERSISTENT_ACTIVE_ATTR } from "@/lib/ui/buttonInteraction";
import {
  PlaybackControlsCard,
  type PlaybackControlsCardProps,
} from "@/pages/playFiles/components/PlaybackControlsCard";

const buildProps = (overrides: Partial<PlaybackControlsCardProps> = {}): PlaybackControlsCardProps => ({
  hasCurrentItem: false,
  currentItemLabel: null,
  currentDurationLabel: null,
  subsongLabel: null,
  canTransport: true,
  hasPrev: false,
  hasNext: true,
  isPlaying: false,
  isPaused: false,
  hasPlaylist: true,
  isPlaylistLoading: false,
  canPause: false,
  onPrevious: vi.fn(),
  onPlay: vi.fn(),
  onStop: vi.fn(),
  onPauseResume: vi.fn(),
  onNext: vi.fn(),
  progressPercent: 0,
  elapsedLabel: "0:00",
  remainingLabel: "0:00",
  totalLabel: "0:00",
  remainingTotalLabel: "0:00",
  volumeControls: <div data-testid="volume-controls-placeholder" />,
  recurseFolders: false,
  onRecurseChange: vi.fn(),
  shuffleEnabled: false,
  onShuffleChange: vi.fn(),
  repeatEnabled: false,
  onRepeatChange: vi.fn(),
  onReshuffle: vi.fn(),
  reshuffleActive: false,
  reshuffleDisabled: true,
  ...overrides,
});

describe("PlaybackControlsCard", () => {
  it("promotes the play button from transient flash to persistent highlight while playback is active", () => {
    vi.useFakeTimers();
    const props = buildProps();
    const { rerender } = render(<PlaybackControlsCard {...props} />);

    const playButton = screen.getByTestId("playlist-play");
    fireEvent.click(playButton, { detail: 1 });

    expect(playButton).toHaveAttribute("data-c64-tap-flash", "true");
    expect(props.onPlay).toHaveBeenCalledTimes(1);

    rerender(<PlaybackControlsCard {...buildProps({ isPlaying: true, canPause: true })} />);

    expect(screen.getByTestId("playlist-play")).toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR, "true");

    vi.advanceTimersByTime(CTA_HIGHLIGHT_DURATION_MS);

    expect(screen.getByTestId("playlist-play")).not.toHaveAttribute("data-c64-tap-flash");
    expect(screen.getByTestId("playlist-play")).toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR, "true");

    rerender(<PlaybackControlsCard {...buildProps({ isPlaying: true, isPaused: true, canPause: true })} />);

    expect(screen.getByTestId("playlist-play")).not.toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR);

    rerender(<PlaybackControlsCard {...buildProps({ isPlaying: false })} />);

    expect(screen.getByTestId("playlist-play")).not.toHaveAttribute(CTA_PERSISTENT_ACTIVE_ATTR);
    vi.useRealTimers();
  });

  it("disables Stop with the reset-safety reason while playing when stopDisabled is set (BUG-017)", () => {
    const onStop = vi.fn();
    render(
      <PlaybackControlsCard
        {...buildProps({
          isPlaying: true,
          canPause: true,
          stopDisabled: true,
          stopDisabledReason: "Stop is disabled on a C64U for non-disk playback. Use Pause instead.",
          onStop,
        })}
      />,
    );

    const stopButton = screen.getByTestId("playlist-play");
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveAttribute(
      "title",
      "Stop is disabled on a C64U for non-disk playback. Use Pause instead.",
    );
    fireEvent.click(stopButton, { detail: 1 });
    expect(onStop).not.toHaveBeenCalled();
  });

  it("keeps Stop enabled while playing when stopDisabled is not set", () => {
    const onStop = vi.fn();
    render(<PlaybackControlsCard {...buildProps({ isPlaying: true, canPause: true, onStop })} />);

    const stopButton = screen.getByTestId("playlist-play");
    expect(stopButton).not.toBeDisabled();
    expect(stopButton).toHaveAttribute("title", "Stop");
    fireEvent.click(stopButton, { detail: 1 });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("keeps track metadata and transport controls stacked full-width", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "intro.sid",
          currentDurationLabel: "02:31",
          canPause: true,
        })}
      />,
    );

    expect(screen.getByTestId("playback-controls-layout")).toHaveClass("flex-col");
    expect(screen.getByTestId("playback-current-track")).toHaveClass("w-full");
    expect(screen.getByTestId("playback-controls-stack")).toHaveClass("w-full");
  });
});
