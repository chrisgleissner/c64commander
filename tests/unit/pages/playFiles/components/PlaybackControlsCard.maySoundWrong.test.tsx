/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import type { PlaybackTimeline } from "@/pages/playFiles/playbackTimeline";
import {
  PlaybackControlsCard,
  type PlaybackControlsCardProps,
} from "@/pages/playFiles/components/PlaybackControlsCard";
import { setMaySoundWrong } from "@/pages/playFiles/maySoundWrongStore";

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
  volumeControls: <div />,
  shuffleEnabled: false,
  onShuffleChange: vi.fn(),
  repeatOneEnabled: false,
  onRepeatOneChange: vi.fn(),
  repeatEnabled: false,
  onRepeatChange: vi.fn(),
  ...overrides,
});

beforeEach(() => setMaySoundWrong(false));
afterEach(cleanup);

describe("the may sound wrong chip on the Now Playing card", () => {
  it("is absent for a tune the player has nothing against", () => {
    render(<PlaybackControlsCard {...props()} />);
    expect(screen.queryByTestId("may-sound-wrong-chip")).toBeNull();
  });

  it("shows beside the title of a playing tune that needs ROMs the phone lacks", () => {
    setMaySoundWrong(true);
    render(<PlaybackControlsCard {...props()} />);

    const chip = screen.getByTestId("may-sound-wrong-chip");
    expect(chip).toHaveTextContent("May sound wrong");
    expect(chip.parentElement).toBe(screen.getByTestId("playback-current-title").parentElement);
    expect(chip.getAttribute("title")).toMatch(/needs the C64 ROMs/);
  });

  it("appears and disappears as the flag changes, without remounting the card", () => {
    render(<PlaybackControlsCard {...props()} />);
    expect(screen.queryByTestId("may-sound-wrong-chip")).toBeNull();

    act(() => setMaySoundWrong(true));
    expect(screen.getByTestId("may-sound-wrong-chip")).toBeInTheDocument();

    act(() => setMaySoundWrong(false));
    expect(screen.queryByTestId("may-sound-wrong-chip")).toBeNull();
  });

  it.each([
    ["nothing is playing", { isPlaying: false }],
    ["no tune is chosen", { hasCurrentItem: false }],
  ])("is hidden when %s, whatever the last launch left behind", (_name, overrides) => {
    setMaySoundWrong(true);
    render(<PlaybackControlsCard {...props(overrides)} />);
    expect(screen.queryByTestId("may-sound-wrong-chip")).toBeNull();
  });

  it("is plain text: no button, no focus stop, and at least 14 px tall type", () => {
    setMaySoundWrong(true);
    render(<PlaybackControlsCard {...props()} />);

    const chip = screen.getByTestId("may-sound-wrong-chip");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.hasAttribute("tabindex")).toBe(false);
    expect(chip.closest("button")).toBeNull();
    expect(chip.className).toMatch(/\btext-sm\b/);
    expect(chip.className).toMatch(/\bshrink-0\b/);
  });

  it("keeps the title row the same height with and without the chip", () => {
    const { unmount } = render(<PlaybackControlsCard {...props()} />);
    const withoutChip = screen.getByTestId("playback-current-track").firstElementChild?.className;
    unmount();
    setMaySoundWrong(true);
    render(<PlaybackControlsCard {...props()} />);
    expect(screen.getByTestId("playback-current-track").firstElementChild?.className).toBe(withoutChip);
  });
});
