/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NowPlayingMetadataSegment } from "@/lib/playback/nowPlayingMetadata";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import type { PlaybackTimeline } from "@/pages/playFiles/playbackTimeline";

const focusItemRenders = vi.hoisted(() => ({ byId: new Map<string, number>() }));

vi.mock("@/hooks/useFocusNavigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useFocusNavigation")>();
  return {
    ...actual,
    useFocusItem: (options: Parameters<typeof actual.useFocusItem>[0]) => {
      focusItemRenders.byId.set(options.id, (focusItemRenders.byId.get(options.id) ?? 0) + 1);
      return actual.useFocusItem(options);
    },
  };
});

import {
  PlaybackControlsCard,
  type PlaybackControlsCardProps,
} from "@/pages/playFiles/components/PlaybackControlsCard";

const display = {
  progressPercent: 10,
  elapsedLabel: "0:10",
  remainingLabel: "-1:50",
  totalLabel: "2:00",
  remainingTotalLabel: "2:00",
  playlistCountersShown: false,
};
const timeline: PlaybackTimeline = { playbackTime: createPlaybackTimeStore(), display: () => display };

const credits = (author: string): NowPlayingMetadataSegment[] => [{ kind: "author", row: "credits", text: author }];

const buildProps = (author: string, stil: PlaybackControlsCardProps["stil"]): PlaybackControlsCardProps => ({
  timeline,
  hasCurrentItem: true,
  currentItemLabel: "Commando",
  currentItemMetadataParts: credits(author),
  stil,
  canTransport: true,
  hasPrev: true,
  hasNext: true,
  isPlaying: true,
  isPaused: false,
  hasPlaylist: true,
  isPlaylistLoading: false,
  canPause: true,
  onPrevious: () => undefined,
  onPlay: () => undefined,
  onStop: () => undefined,
  onPauseResume: () => undefined,
  onNext: () => undefined,
  onSeek: () => undefined,
  onScrubStart: () => undefined,
  onScrubStep: () => undefined,
  onScrubEnd: () => undefined,
  onSeekToFraction: () => undefined,
  pendingSeek: undefined,
  volumeControls: <div />,
  shuffleEnabled: false,
  onShuffleChange: () => undefined,
  repeatOneEnabled: false,
  onRepeatOneChange: () => undefined,
  repeatEnabled: false,
  onRepeatChange: () => undefined,
});

const transportRenders = () => focusItemRenders.byId.get("play-transport-play") ?? 0;
const cardRenders = () => focusItemRenders.byId.get("play-transport-shuffle") ?? 0;

describe("PlaybackControlsCard render isolation", () => {
  afterEach(() => {
    cleanup();
    focusItemRenders.byId.clear();
  });

  it("does not re-render the transport when metadata arrives or the page hands over fresh callbacks", () => {
    const { rerender } = render(<PlaybackControlsCard {...buildProps("", undefined)} />);
    const transportBefore = transportRenders();
    const cardBefore = cardRenders();

    rerender(
      <PlaybackControlsCard
        {...buildProps("Rob Hubbard", { title: "BGM1", originalArtist: "Tamayo Kawamoto", note: "A note." })}
      />,
    );

    expect(screen.getByTestId("playback-current-credits")).toHaveTextContent("Rob Hubbard");
    expect(cardRenders() - cardBefore, "the metadata slots re-rendered").toBeGreaterThan(0);
    expect(transportRenders() - transportBefore, "extra transport renders").toBe(0);
  });

  it("does not re-render the transport for a position tick", () => {
    render(<PlaybackControlsCard {...buildProps("Rob Hubbard", undefined)} />);
    const transportBefore = transportRenders();

    act(() => timeline.playbackTime.setElapsedMs(11_000));

    expect(transportRenders() - transportBefore).toBe(0);
  });

  it("re-renders the transport when a control state it shows changes", () => {
    const { rerender } = render(<PlaybackControlsCard {...buildProps("Rob Hubbard", undefined)} />);
    const transportBefore = transportRenders();

    rerender(<PlaybackControlsCard {...buildProps("Rob Hubbard", undefined)} isPaused />);

    expect(transportRenders() - transportBefore).toBe(1);
  });
});
