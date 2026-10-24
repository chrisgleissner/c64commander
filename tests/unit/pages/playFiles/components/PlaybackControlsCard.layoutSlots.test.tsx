/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Radio } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useStableCallback } from "@/hooks/useStableCallback";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import type { PlaybackTimeline } from "@/pages/playFiles/playbackTimeline";
import {
  PlaybackControlsCard,
  type PlaybackControlsCardProps,
} from "@/pages/playFiles/components/PlaybackControlsCard";
import { SidRadioChip } from "@/pages/playFiles/components/SidRadioChip";

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
      expect(screen.getByTestId("playback-current-credits").className).toMatch(/\bh-11\b/);
      expect(screen.getByTestId("playback-current-facts").className).toMatch(/\bh-11\b/);
      expect(screen.getByTestId("playback-current-track").firstElementChild?.className).toMatch(/\bh-6\b/);
      unmount();
    }
  });

  it("draws the STIL details and the station explanation after the transport", () => {
    render(
      <PlaybackControlsCard
        {...props({
          stil: { title: "BGM1", originalArtist: "Kawamoto", note: "A note." },
          stationWhy: "Similar to Commando",
          stationIndicator: (why) => <button data-testid="why-toggle" onClick={why.onToggle} />,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("why-toggle"));
    const play = screen.getByTestId("playlist-play");
    expect(before(play, screen.getByTestId("tune-details"))).toBe(true);
    expect(before(play, screen.getByTestId("sid-radio-why"))).toBe(true);
  });

  it("draws the stopping status after the progress bar", () => {
    render(<PlaybackControlsCard {...props({ stopping: true })} />);
    expect(before(screen.getByTestId("playback-progress"), screen.getByTestId("playback-stop-status"))).toBe(true);
  });

  it("reserves a width for both time labels", () => {
    render(<PlaybackControlsCard {...props()} />);
    expect(screen.getByTestId("playback-remaining").className).toMatch(/min-w-\[6ch\]/);
    expect(screen.getByTestId("playback-elapsed").innerHTML).toMatch(/min-w-\[5ch\]/);
  });
});

describe("pieces that keep the page still", () => {
  it("SidRadioChip with an external explanation never draws it inline", () => {
    const station = { seedKind: "style", seedLabel: "Melodic", styleBit: null } as never;
    render(
      <SidRadioChip
        station={station}
        whyThisTune="Matches Melodic"
        onStop={vi.fn()}
        externalWhy={{ expanded: true, onToggle: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId("sid-radio-why")).toBeNull();
  });

  it("CollapsibleSection with revealOnOpen off does not scroll when opened", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    render(
      <CollapsibleSection scope="test" id="still" title="Still" icon={Radio} revealOnOpen={false}>
        <p>Body</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByTestId("test-section-toggle-still"));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("useStableCallback keeps its identity, calls the latest function and keeps undefined", () => {
    const first = vi.fn(() => 1);
    const second = vi.fn(() => 2);
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: first as (() => number) | undefined },
    });
    const stable = result.current;
    rerender({ fn: second });
    expect(result.current).toBe(stable);
    expect(stable?.()).toBe(2);
    rerender({ fn: undefined });
    expect(result.current).toBeUndefined();
  });
});
