/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PENDING_ANNOUNCEMENT_INTERVAL_MS, type PendingSeekPresentation } from "@/lib/playback/pendingSeekStatus";
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
  shuffleSeed: null,
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

  // HARD12-017
  it("renders the openControllerAction slot when provided, and nothing when omitted", () => {
    const { rerender } = render(<PlaybackControlsCard {...buildProps()} />);
    expect(screen.queryByTestId("open-controller-slot")).not.toBeInTheDocument();

    rerender(
      <PlaybackControlsCard
        {...buildProps({ openControllerAction: <button data-testid="open-controller-slot">Open Controller</button> })}
      />,
    );
    expect(screen.getByTestId("open-controller-slot")).toBeInTheDocument();
  });

  it("badges the SID chip count beside the now-playing title", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({ hasCurrentItem: true, currentItemLabel: "Bossa in Do", currentItemChipCount: 2 })}
      />,
    );

    const track = screen.getByTestId("playback-current-track");
    expect(track).toHaveTextContent("Bossa in Do");
    expect(within(track).getByTestId("sid-chip-badge-2")).toHaveTextContent("2SID");
  });

  it("draws no chip badge when the chip count is unknown", () => {
    render(<PlaybackControlsCard {...buildProps({ hasCurrentItem: true, currentItemLabel: "Bossa in Do" })} />);

    expect(screen.queryByTestId("sid-chip-badge-1")).toBeNull();
    expect(screen.queryByTestId("sid-chip-badge-2")).toBeNull();
    expect(screen.queryByTestId("sid-chip-badge-3")).toBeNull();
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

  it("shows composer and year under the title, smaller than it", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemAuthor: "Rob Hubbard",
          currentItemReleased: "1985 Elite",
        })}
      />,
    );

    const credits = screen.getByTestId("playback-current-credits");
    expect(credits).toHaveTextContent("Rob Hubbard");
    expect(credits).toHaveTextContent("1985 Elite");
    // Readable: a step below the title rather than the smallest type on the page. The title is
    // text-base, so credits are text-sm — the same primary/secondary pairing used elsewhere.
    expect(credits.className).toContain("text-sm");
  });

  it("shows nothing extra for a tune that names neither", () => {
    render(<PlaybackControlsCard {...buildProps({ hasCurrentItem: true, currentItemLabel: "Untitled" })} />);

    expect(screen.queryByTestId("playback-current-credits")).toBeNull();
    // And the empty-state text does not leak in just because there are no credits.
    expect(screen.getByTestId("playback-current-track")).not.toHaveTextContent("Select a playlist item");
  });

  it("shows how far the tune is rendered ahead of where it is playing", () => {
    // libsidplayfp cannot rewind, so this is exactly how far a seek can land instantly. A translucent
    // fill behind the played portion says so without a spinner or a number.
    render(
      <PlaybackControlsCard
        {...buildProps({ hasCurrentItem: true, progressPercent: 20, renderedPercent: 65, onSeekToFraction: () => {} })}
      />,
    );

    expect(screen.getByTestId("playback-rendered-ahead")).toHaveAttribute("data-rendered-percent", "65");
  });

  it("still shows the fill when rendering is BEHIND the playhead, which is when it matters most", () => {
    // Hiding it then was backwards: a listener who has just dragged past what is rendered needs to see
    // the renderer catching up, not wonder whether playback has died.
    render(
      <PlaybackControlsCard
        {...buildProps({ hasCurrentItem: true, progressPercent: 60, renderedPercent: 30, onSeekToFraction: () => {} })}
      />,
    );

    expect(screen.getByTestId("playback-rendered-ahead")).toHaveAttribute("data-rendered-percent", "30");
  });

  it("omits the fill once the whole tune is rendered, since there is nothing left to report", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({ hasCurrentItem: true, progressPercent: 40, renderedPercent: 100, onSeekToFraction: () => {} })}
      />,
    );

    expect(screen.queryByTestId("playback-rendered-ahead")).toBeNull();
  });
});

/**
 * Waiting for the renderer to reach a seek.
 *
 * A phone has no hover, so none of this may live in a tooltip, and a wait with no visible end is
 * what a listener reads as a fault. Everything here is therefore inline, determinate, and says the
 * same thing twice — once for the eye and once, more slowly, for a screen reader.
 */
describe("PlaybackControlsCard pending seek", () => {
  const pending = (overrides: Partial<PendingSeekPresentation> = {}): PendingSeekPresentation => ({
    targetPercent: 40,
    startedAtPercent: 10,
    renderedPercent: 24,
    audibleMs: 12_000,
    progress: 0.68,
    progressPercent: 68,
    etaSeconds: 4,
    almostReady: false,
    targetLabel: "0:27",
    statusText: "Preparing audio for 0:27 · 68% · about 4 s",
    liveText: "Rendering audio for position 27 seconds. 68 percent ready. About 4 seconds remaining.",
    ...overrides,
  });

  const renderPending = (overrides: Partial<PendingSeekPresentation> = {}) =>
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          progressPercent: 8,
          renderedPercent: 24,
          onSeekToFraction: () => {},
          pendingSeek: pending(overrides),
        })}
      />,
    );

  it("states the position, the percentage and the estimate under the bar rather than in a tooltip", () => {
    renderPending();

    const status = screen.getByTestId("playback-pending-status");
    expect(status).toHaveTextContent("Preparing audio for 0:27 · 68% · about 4 s");
    expect(status).toHaveAttribute("data-pending-progress", "68");
    // Not a `title` anywhere: there is no hover on the device this runs on.
    expect(status).not.toHaveAttribute("title");
  });

  it("gives the target marker a cap, the requested time and a name of its own", () => {
    renderPending();

    const marker = screen.getByTestId("playback-awaited-marker");
    expect(marker).toHaveAttribute("data-awaited-percent", "40");
    expect(marker).toHaveAccessibleName("Waiting to continue at 0:27, 68% ready");
    expect(screen.getByTestId("playback-awaited-timestamp")).toHaveTextContent("0:27");
  });

  it("draws the span still to render from the head towards the target", () => {
    renderPending({ renderedPercent: 24, targetPercent: 40 });

    const region = screen.getByTestId("playback-pending-region");
    expect(region.style.left).toBe("24%");
    expect(region.style.width).toBe("16%");
    // A texture as well as a tint, so the state is not distinguished by colour alone.
    expect(region.className).toContain("playback-pending-region");
  });

  it("marks the elapsed clock as held, and never with an hourglass", () => {
    renderPending();

    const elapsed = screen.getByTestId("playback-elapsed");
    expect(elapsed).toHaveAttribute("data-elapsed-held", "true");
    expect(elapsed.textContent).not.toContain("⏳");
  });

  it("shows none of it once nothing is pending", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({ hasCurrentItem: true, progressPercent: 8, renderedPercent: 24, onSeekToFraction: () => {} })}
      />,
    );

    expect(screen.queryByTestId("playback-pending-status")).toBeNull();
    expect(screen.queryByTestId("playback-awaited-marker")).toBeNull();
    expect(screen.queryByTestId("playback-pending-region")).toBeNull();
    expect(screen.getByTestId("playback-elapsed")).not.toHaveAttribute("data-elapsed-held");
  });

  it("keeps the estimate out of the status when there is no valid one", () => {
    renderPending({
      etaSeconds: null,
      statusText: "Preparing audio for 0:27 · 68%",
      liveText: "Rendering audio for position 27 seconds. 68 percent ready.",
    });

    const status = screen.getByTestId("playback-pending-status");
    expect(status).toHaveTextContent("Preparing audio for 0:27 · 68%");
    expect(status).not.toHaveAttribute("data-pending-eta");
  });

  it("announces the wait politely, and throttles a changing message", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <PlaybackControlsCard
          {...buildProps({ hasCurrentItem: true, onSeekToFraction: () => {}, pendingSeek: pending() })}
        />,
      );
      const region = screen.getByTestId("playback-pending-announcement");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveTextContent("Rendering audio for position 27 seconds. 68 percent ready.");

      // The status refreshes twice a second; a live region given that talks over itself.
      rerender(
        <PlaybackControlsCard
          {...buildProps({
            hasCurrentItem: true,
            onSeekToFraction: () => {},
            pendingSeek: pending({
              progressPercent: 71,
              liveText: "Rendering audio for position 27 seconds. 71 percent ready.",
            }),
          })}
        />,
      );
      expect(region).toHaveTextContent("68 percent ready");

      act(() => {
        vi.advanceTimersByTime(PENDING_ANNOUNCEMENT_INTERVAL_MS + 10);
      });
      expect(region).toHaveTextContent("71 percent ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops announcing the moment the wait ends", () => {
    const { rerender } = render(
      <PlaybackControlsCard
        {...buildProps({ hasCurrentItem: true, onSeekToFraction: () => {}, pendingSeek: pending() })}
      />,
    );
    expect(screen.getByTestId("playback-pending-announcement")).toHaveTextContent("68 percent ready");

    rerender(<PlaybackControlsCard {...buildProps({ hasCurrentItem: true, onSeekToFraction: () => {} })} />);

    expect(screen.getByTestId("playback-pending-announcement")).toHaveTextContent("");
  });
});
