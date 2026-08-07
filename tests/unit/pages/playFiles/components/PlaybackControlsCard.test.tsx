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
import type { NowPlayingMetadataSegment } from "@/lib/playback/nowPlayingMetadata";
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

/**
 * The metadata line, as the card now takes it: labelled parts rather than a finished string, so the
 * composer can be a control and the rest text. The first is always the composer.
 */
/**
 * Mirrors the real builder's shape: author and released make the credits line, everything
 * after them makes the facts line. The card prints the two as separate rows and puts the
 * ranking actions at the right of the facts one.
 */
const metadataParts = (author: string, released?: string, ...facts: string[]): NowPlayingMetadataSegment[] => [
  { text: author, kind: "author", row: "credits" },
  ...(released ? [{ text: released, kind: "detail", row: "credits" } as NowPlayingMetadataSegment] : []),
  ...facts.map((text): NowPlayingMetadataSegment => ({ text, kind: "detail", row: "facts" })),
];

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
  it("gives the title a row to itself, with nothing beside it", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Bossa in Do",
          currentItemMetadataParts: metadataParts("Jeroen Tel", "1988", "6581 / 8580", "PAL", "2:07"),
          rankingControls: <button data-testid="ranking-slot">rank</button>,
        })}
      />,
    );

    const titleRow = screen.getByTestId("playback-current-title").parentElement as HTMLElement;
    expect(titleRow.childElementCount).toBe(1);
    expect(titleRow.textContent).toBe("Bossa in Do");
    expect(within(titleRow).queryByTestId("ranking-slot")).toBeNull();
    expect(screen.queryByTestId("sid-chip-badge-2")).toBeNull();
    // The length and which-tune-of-how-many are on the facts line now, not beside the title.
    expect(screen.getByTestId("playback-current-facts")).toHaveTextContent("2:07");
  });

  it("puts the ranking actions at the right of the facts line, not on a row of their own", () => {
    // The heart and the cross are two 44 px buttons. Beside the title they cut a 288 px row
    // short on every tune with a name of any length, so they were moved to a row above it -
    // which then spent a whole row on two buttons. They now sit at the right of the facts
    // line, which is short enough to share: "6581 · PAL · 2:07" leaves room beside it.
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Bossa in Do",
          currentItemMetadataParts: metadataParts("Jeroen Tel", "1988", "6581", "PAL", "2:07"),
          rankingControls: <button data-testid="ranking-slot">rank</button>,
        })}
      />,
    );

    const rankingRow = screen.getByTestId("playback-ranking-row");
    const facts = screen.getByTestId("playback-current-facts");
    const titleRow = screen.getByTestId("playback-current-title").parentElement as HTMLElement;

    expect(within(rankingRow).getByTestId("ranking-slot")).toBeInTheDocument();
    // Beside the facts, sharing one row: same parent, and the facts come first.
    expect(rankingRow.parentElement).toBe(facts.parentElement);
    expect(facts.compareDocumentPosition(rankingRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Below the title, which keeps the full width to itself.
    expect(titleRow.compareDocumentPosition(rankingRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // shrink-0 so the actions keep their targets whatever the facts line does.
    expect(rankingRow.className).toContain("shrink-0");
  });

  it("keeps a long title on one line and does not lose any of it", () => {
    // The card must be exactly as tall for a forty-character HVSC name as for a short one, so the
    // title is clipped rather than wrapped. Clipping must not lose the name.
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

    expect(titleRow.className).toContain("w-full");
    expect(titleRow.className).toContain("flex-nowrap");
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("flex-1");
    expect(title.className).toContain("truncate");
    // `truncate` is text-overflow, so the whole string is still in the document — which is what a
    // screen reader reads — and the tooltip carries it for a pointer.
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
          currentItemMetadataParts: metadataParts("Rob Hubbard", "1985 Elite", "6581", "PAL", "2/3", "3:12"),
        })}
      />,
    );

    const credits = screen.getByTestId("playback-current-credits");
    const facts = screen.getByTestId("playback-current-facts");
    // Who made it and when on the first line; what the file is on the second.
    expect(credits).toHaveTextContent("Rob Hubbard");
    expect(credits).toHaveTextContent("1985 Elite");
    expect(facts).toHaveTextContent("2/3");
    expect(facts).toHaveTextContent("3:12");
    expect(facts.textContent).not.toContain("Subsong");
    expect(facts.textContent).not.toContain("Tune 2 of 3");
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
          currentItemMetadataParts: metadataParts("Rob Hubbard"),
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

describe("PlaybackControlsCard STIL and composer", () => {
  it("makes the composer a way to find more by them, and leaves the rest as text", () => {
    const onComposerSelected = vi.fn();
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemMetadataParts: metadataParts("Rob Hubbard", "1985 Elite", "6581", "PAL", "3:12"),
          onComposerSelected,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("playback-current-composer"));
    expect(onComposerSelected).toHaveBeenCalledWith("Rob Hubbard");
    // Each line still reads as a line: the composer is the only control among them.
    const credits = screen.getByTestId("playback-current-credits");
    const facts = screen.getByTestId("playback-current-facts");
    expect(within(credits).getAllByRole("button")).toHaveLength(1);
    expect(credits).toHaveTextContent("Rob Hubbard · 1985 Elite");
    expect(facts).toHaveTextContent("6581 · PAL · 3:12");
  });

  it("leaves the composer inert where there is nowhere to go", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemMetadataParts: metadataParts("Rob Hubbard", "1985 Elite"),
        })}
      />,
    );
    expect(screen.queryByTestId("playback-current-composer")).toBeNull();
    expect(screen.getByTestId("playback-current-credits")).toHaveTextContent("Rob Hubbard · 1985 Elite");
  });

  it("says what the tune is and who wrote the music, which the header cannot", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemMetadataParts: metadataParts("Rob Hubbard", "1985 Elite"),
          stil: { title: "BGM1", originalArtist: "Tamayo Kawamoto", note: null },
        })}
      />,
    );
    // Folded away by default; the header line stays on the card either way.
    expect(screen.queryByTestId("playback-current-stil")).toBeNull();
    expect(screen.getByTestId("playback-current-credits")).toHaveTextContent("Rob Hubbard");

    fireEvent.click(screen.getByTestId("tune-details-toggle"));
    // The header credits Rob Hubbard, who arranged it; STIL credits the person who wrote it.
    expect(screen.getByTestId("playback-current-stil")).toHaveTextContent("BGM1 · music by Tamayo Kawamoto");
  });

  it("keeps the STIL block folded away until it is asked for", () => {
    // The smallest supported screen is 320 x 426 CSS px, and a tune with a full STIL entry spent
    // five lines of the card on it. Collapsed, the whole block costs one labelled row.
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemMetadataParts: metadataParts("Rob Hubbard", "1985 Elite", "6581", "PAL", "3:12"),
          stil: {
            title: "The Devil's Gallop",
            originalArtist: "Charles Williams",
            note: "Heavily inspired by the song Devil's Gallop.",
          },
        })}
      />,
    );

    // Core stays: the title and the header line, which carry both of the block's controls.
    expect(screen.getByTestId("playback-current-title")).toHaveTextContent("Commando");
    expect(screen.getByTestId("playback-current-credits")).toHaveTextContent("Rob Hubbard");

    const toggle = screen.getByTestId("tune-details-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("tune-details-body")).toBeNull();
    expect(screen.queryByTestId("playback-current-stil")).toBeNull();
    expect(screen.queryByTestId("tune-notes")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("playback-current-stil")).toHaveTextContent("The Devil's Gallop");
    expect(screen.getByTestId("tune-notes-text")).toHaveTextContent("Devil's Gallop");
  });

  it("adds nothing for the majority of the archive, which STIL does not describe", () => {
    render(
      <PlaybackControlsCard
        {...buildProps({
          hasCurrentItem: true,
          currentItemLabel: "Commando",
          currentItemMetadataParts: metadataParts("Rob Hubbard"),
          stil: { title: null, originalArtist: null, note: null },
        })}
      />,
    );
    expect(screen.queryByTestId("tune-details")).toBeNull();
    expect(screen.queryByTestId("tune-details-toggle")).toBeNull();
    expect(screen.queryByTestId("playback-current-stil")).toBeNull();
    expect(screen.queryByTestId("tune-notes")).toBeNull();
  });
});
