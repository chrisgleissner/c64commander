/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  // The 2SID/3SID badge used to sit beside the title. It has gone from this card, and these
  // assertions with it: the metadata line now names one SID model per chip, which states the chip
  // count and says which chips they are, so a badge repeating the count would be the same fact twice
  // on the one line that was specified to carry the title and the ranking actions and nothing else.
  // The badge is untouched on the playlist rows and in Liked Tunes, where there is no metadata line.
  it("carries the title and the ranking actions on the title row, and nothing else", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Bossa in Do",
          currentItemMetadata: "Jeroen Tel - 1988 - 6581 / 8580 - PAL - 2:07",
          rankingControls: <button data-testid="ranking-slot">rank</button>,
        })}
      />,
    );

    const titleRow = screen.getByTestId("playback-current-title").parentElement as HTMLElement;
    expect(titleRow.childElementCount).toBe(2);
    expect(within(titleRow).getByTestId("ranking-slot")).toBeInTheDocument();
    expect(titleRow.textContent).toBe("Bossa in Dorank");
    expect(screen.queryByTestId("sid-chip-badge-2")).toBeNull();
    // The length and which-tune-of-how-many are on the line below now, not beside the title.
    expect(screen.getByTestId("playback-current-credits")).toHaveTextContent("2:07");
  });

  it("holds the ranking actions in the same place however long the title is", () => {
    // Muscle memory: the ♥ and the ✕ must not move between tunes. Two things do that — the row never
    // wraps, and the action track never shrinks — so a title long enough to overflow is truncated
    // inside its own box instead of pushing them anywhere.
    const longTitle = "Sanxion Loader Tune Extended Remix With A Very Long Name Indeed";
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: longTitle,
          rankingControls: <button data-testid="ranking-slot">rank</button>,
        })}
      />,
    );

    const title = screen.getByTestId("playback-current-title");
    const titleRow = title.parentElement as HTMLElement;
    const actions = within(titleRow).getByTestId("ranking-slot").parentElement as HTMLElement;

    expect(titleRow.className).toContain("flex-nowrap");
    expect(titleRow.className).not.toContain("flex-wrap");
    expect(actions.className).toContain("shrink-0");
    // The title yields the space instead: it may shrink below its content width and is clipped there.
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("flex-1");
    expect(title.className).toContain("truncate");
    // Truncating must not lose the name. `truncate` is text-overflow, so the whole string is still
    // in the document — which is what a screen reader reads — and the tooltip carries it for a
    // pointer.
    expect(title).toHaveTextContent(longTitle);
    expect(title).toHaveAttribute("title", longTitle);
  });

  /**
   * Reading order: where the queue comes from, then the tune, then the controls. The station
   * indicator used to be the *last* thing on the card, under the transport, the progress bar, the
   * volume row and the playlist toggles, which is the wrong end — it is context for all of them.
   */
  it("draws the station indicator above the title, in both station states", () => {
    for (const stationActive of [false, true]) {
      const { unmount } = render(
        <PlaybackControlsCard
          {...buildProps({
            hasCurrentItem: true,
            currentItemLabel: "Commando",
            stationActive,
            stationIndicator: <div data-testid="station-indicator-slot" />,
          })}
        />,
      );

      const layout = screen.getByTestId("playback-controls-layout");
      expect(layout.firstElementChild).toHaveAttribute("data-testid", "station-indicator-slot");
      const indicator = screen.getByTestId("station-indicator-slot");
      const track = screen.getByTestId("playback-current-track");
      expect(indicator.compareDocumentPosition(track) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      unmount();
    }
  });

  /**
   * A station is a mode, not a passing unavailability: nothing the user can do re-enables Shuffle,
   * Repeat or Reshuffle while one runs, because the station owns the play order by definition. So
   * they are removed rather than greyed, and the row they sat in goes with them — a row left holding
   * one control, or a row of greyed controls, would spend vertical space on nothing.
   */
  it("drops the whole order row while a station runs, leaving the transport and the ranking pair", () => {
    const { container } = render(
      <PlaybackControlsCard {...buildProps({ stationActive: true, reshuffleDisabled: false })} />,
    );

    expect(screen.queryByTestId("playback-shuffle")).toBeNull();
    expect(screen.queryByTestId("playback-repeat")).toBeNull();
    expect(screen.queryByTestId("playlist-reshuffle")).toBeNull();
    // Recurse is no longer a playback control at all; it lives in the Add items sheet.
    expect(screen.queryByTestId("playback-recurse")).toBeNull();
    // What a listener still needs is untouched.
    expect(screen.getByTestId("playback-transport-row")).toBeInTheDocument();
    // And the space is actually given back, rather than an empty row being left behind. Counted
    // against the same render with no station, so the assertion cannot pass by naming a class that
    // is never present.
    const rowsDuringStation = container.querySelectorAll(".flex.flex-wrap.items-center.gap-3").length;
    cleanup();
    const idle = render(<PlaybackControlsCard {...buildProps({ reshuffleDisabled: false })} />);
    expect(idle.container.querySelectorAll(".flex.flex-wrap.items-center.gap-3").length).toBeGreaterThan(
      rowsDuringStation,
    );
    expect(rowsDuringStation).toBe(0);
  });

  it("puts the order controls back, with the values the user had, once the station stops", () => {
    // Nothing is mutated while they are hidden: the card only stops drawing them, so stopping a
    // station returns the playlist exactly as it was left.
    const props = buildProps({ shuffleEnabled: true, repeatEnabled: true, reshuffleDisabled: false });
    const { rerender } = render(<PlaybackControlsCard {...props} stationActive />);

    expect(screen.queryByTestId("playback-shuffle")).toBeNull();

    rerender(<PlaybackControlsCard {...props} stationActive={false} />);

    expect(screen.getByTestId("playback-shuffle")).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("playback-repeat")).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("playlist-reshuffle")).toBeEnabled();
  });

  it("spreads the transport across the card so its ends sit on the card's own edges", () => {
    // The buttons are a fixed 44 px, so in the previous `grid-cols-4` they sat at the left of cells
    // wider than themselves and the row stopped short of the right edge — visibly ragged against
    // the ranking pair above it and the progress bar below it, both of which are flush.
    render(<PlaybackControlsCard {...buildProps()} />);

    const row = screen.getByTestId("playback-transport-row");
    expect(row.className).toContain("justify-between");
    expect(row.className).not.toMatch(/\bgrid-cols-4\b/);
    expect(row.firstElementChild).toHaveAttribute("data-testid", "playlist-prev");
    expect(row.lastElementChild).toHaveAttribute("data-testid", "playlist-next");
  });

  it("keeps track metadata and transport controls stacked full-width", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "intro.sid",
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

  it("shows what the tune says about itself under the title, smaller than it", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemMetadata: "Rob Hubbard - 1985 Elite - 6581 - PAL - Tune 2 of 3 - 3:12",
        })}
      />,
    );

    const credits = screen.getByTestId("playback-current-credits");
    expect(credits).toHaveTextContent("Rob Hubbard");
    expect(credits).toHaveTextContent("1985 Elite");
    expect(credits).toHaveTextContent("Tune 2 of 3");
    expect(credits.textContent).not.toContain("Subsong");
    // Readable: a step below the title rather than the smallest type on the page. The title is
    // text-base, so credits are text-sm — the same primary/secondary pairing used elsewhere.
    expect(credits.className).toContain("text-sm");
  });

  it("starts the title and the credits on the same left edge, with no glyph in front of either", () => {
    // There used to be a small file-origin glyph before the title, which indented the title by its
    // own width while the credits line below stayed at the card's edge, so the two did not line up.
    // Where a tune came from is already shown against every playlist row, and the page says at the
    // top which device is playing.
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemMetadata: "Rob Hubbard",
        })}
      />,
    );

    const track = screen.getByTestId("playback-current-track");
    expect(within(track).queryByTestId("file-origin-icon")).toBeNull();
    // The title is the first thing on its row, and its row starts at the same edge as the credits:
    // neither carries padding or a margin that would offset one from the other.
    const titleRow = track.firstElementChild as HTMLElement;
    expect(titleRow.firstElementChild).toHaveTextContent("Commando");
    expect(titleRow.className).not.toMatch(/\b(pl-|ml-|indent-)/);
    expect(screen.getByTestId("playback-current-credits").className).not.toMatch(/\b(pl-|ml-|indent-)/);
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
