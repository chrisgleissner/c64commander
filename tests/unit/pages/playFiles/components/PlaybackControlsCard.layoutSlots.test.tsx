/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import type { PlaybackTimeline } from "@/pages/playFiles/playbackTimeline";
import {
  PlaybackControlsCard,
  type PlaybackControlsCardProps,
} from "@/pages/playFiles/components/PlaybackControlsCard";

const timeline: PlaybackTimeline = {
  playbackTime: createPlaybackTimeStore(),
  display: () => ({
    progressPercent: 0,
    elapsedLabel: "0:00",
    remainingLabel: "-1:00",
    totalLabel: "1:00",
    remainingTotalLabel: "1:00",
    playlistCountersShown: false,
  }),
};

const props = (overrides: Partial<PlaybackControlsCardProps> = {}): PlaybackControlsCardProps => ({
  timeline,
  hasCurrentItem: true,
  currentItemLabel: "Commando",
  canTransport: true,
  hasPrev: true,
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
  volumeControls: <div />,
  shuffleEnabled: false,
  onShuffleChange: vi.fn(),
  repeatOneEnabled: false,
  onRepeatOneChange: vi.fn(),
  repeatEnabled: false,
  onRepeatChange: vi.fn(),
  ...overrides,
});

const before = (first: HTMLElement, second: HTMLElement) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(cleanup);

describe("player controls layout slots", () => {
  it("reserves the title, credits and facts lines whatever the tune says", () => {
    for (const hasCurrentItem of [true, false]) {
      const { unmount } = render(<PlaybackControlsCard {...props({ hasCurrentItem })} />);
      expect(screen.getByTestId("playback-current-credits").className).toMatch(/(^|\s)h-\[2lh\] min-h-11(\s|$)/);
      expect(screen.getByTestId("playback-current-facts").className).toMatch(/(^|\s)h-\[2lh\] min-h-11(\s|$)/);
      expect(screen.getByTestId("playback-current-track").firstElementChild?.className).toMatch(/\bh-6\b/);
      unmount();
    }
  });

  it("draws About this tune after the transport", () => {
    render(
      <PlaybackControlsCard {...props({ stil: { title: "BGM1", originalArtist: "Kawamoto", note: "A note." } })} />,
    );
    expect(before(screen.getByTestId("playlist-play"), screen.getByTestId("tune-details"))).toBe(true);
  });

  it("keeps the About this tune row for a tune without STIL, so changing tunes never adds or removes it", () => {
    render(<PlaybackControlsCard {...props()} />);
    expect(screen.getByTestId("tune-details-toggle")).toBeInTheDocument();
  });

  it("makes clipped credits and facts readable in full under About this tune", () => {
    const longCredits = "Jeroen Tel & Charles Deenen of Maniacs";
    render(
      <PlaybackControlsCard
        {...props({
          currentItemMetadataParts: [
            { kind: "author", row: "credits", text: longCredits },
            { kind: "detail", row: "credits", text: "1990 A Publisher With A Rather Long Name Ltd" },
            { kind: "detail", row: "facts", text: "6581" },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("tune-details-toggle"));
    expect(screen.getByTestId("tune-details-credits")).toHaveTextContent(
      `${longCredits} · 1990 A Publisher With A Rather Long Name Ltd`,
    );
    expect(screen.getByTestId("tune-details-facts")).toHaveTextContent("6581");
  });

  it("draws the stopping status after the progress bar", () => {
    render(<PlaybackControlsCard {...props({ stopping: true })} />);
    expect(before(screen.getByTestId("playback-progress"), screen.getByTestId("playback-stop-status"))).toBe(true);
  });

  it("spans the whole card width with the transport and progress stack", () => {
    render(<PlaybackControlsCard {...props()} />);
    expect(screen.getByTestId("playback-controls-stack").className).toMatch(/\bcol-span-3\b/);
  });

  it("reserves a width for both time labels", () => {
    render(<PlaybackControlsCard {...props()} />);
    expect(screen.getByTestId("playback-remaining").className).toMatch(/min-w-\[6ch\]/);
    expect(screen.getByTestId("playback-elapsed").innerHTML).toMatch(/min-w-\[5ch\]/);
  });
});

describe("hold-to-seek after the page withdraws its scrub handlers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not throw when the hold timer fires after onScrubStart was withdrawn", () => {
    vi.useFakeTimers();
    const scrubbing = { onSeek: vi.fn(), onScrubStart: vi.fn(), onScrubStep: vi.fn(), onScrubEnd: vi.fn() };
    const { rerender } = render(<PlaybackControlsCard {...props(scrubbing)} />);
    fireEvent.pointerDown(screen.getByTestId("playlist-next"));
    rerender(<PlaybackControlsCard {...props({ onSeek: scrubbing.onSeek })} />);
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(scrubbing.onScrubStart).not.toHaveBeenCalled();
  });
});
