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
import {
  FocusNavigationProvider,
  useFocusNavigationContext,
  type FocusNavigationContextValue,
} from "@/hooks/useFocusNavigation";

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

const FocusContextCapture = ({ target }: { target: { current: FocusNavigationContextValue | null } }) => {
  target.current = useFocusNavigationContext();
  return null;
};

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

  it("keeps transport CTAs DOM-backed and reachable in the keypad focus ring", () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    const props = buildProps({
      hasPrev: true,
      hasNext: true,
      canPause: true,
      reshuffleDisabled: false,
    });

    render(
      <FocusNavigationProvider profileId="keypad">
        <FocusContextCapture target={focusContext} />
        <PlaybackControlsCard {...props} />
      </FocusNavigationProvider>,
    );

    expect(focusContext.current?.engine.sourceForId("play-transport-previous")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("play-transport-play")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("play-transport-pause")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("play-transport-next")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("play-transport-reshuffle")).toBe("dom+explicit");

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(props.onPrevious).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(screen.getByTestId("playlist-play")).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(screen.getByTestId("playlist-pause")).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(screen.getByTestId("playlist-next")).toHaveFocus();

    for (let step = 0; step < 8 && document.activeElement !== screen.getByTestId("playlist-reshuffle"); step += 1) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
    }
    expect(screen.getByTestId("playlist-reshuffle")).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(props.onReshuffle).toHaveBeenCalledTimes(1);
  });

  it("skips disabled transport CTAs in the keypad focus ring", () => {
    const props = buildProps({
      hasPrev: false,
      canPause: false,
      hasNext: true,
      reshuffleDisabled: true,
    });

    render(
      <FocusNavigationProvider profileId="keypad">
        <PlaybackControlsCard {...props} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(props.onPlay).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(screen.getByTestId("playlist-next")).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onPrevious).not.toHaveBeenCalled();
    expect(props.onPauseResume).not.toHaveBeenCalled();
    expect(props.onReshuffle).not.toHaveBeenCalled();
  });
});
