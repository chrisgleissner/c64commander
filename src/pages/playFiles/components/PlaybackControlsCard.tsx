/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, type ReactNode } from "react";
import { Repeat, Repeat1, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { useStableCallback } from "@/hooks/useStableCallback";
import type { PendingSeekPresentation } from "@/lib/playback/pendingSeekStatus";
import {
  buildStilTuneLine,
  NOW_PLAYING_METADATA_SEPARATOR,
  type NowPlayingMetadataSegment,
} from "@/lib/playback/nowPlayingMetadata";
import type { PlaybackTimeline } from "@/pages/playFiles/playbackTimeline";
import { SidRadioWhy } from "./SidRadioChip";
import { TuneDetails } from "./TuneDetails";
import { PLAY_TRANSPORT_FOCUS_ORDER, PlaybackTransport } from "./PlaybackTransport";

export { seekKeyStepFraction } from "./PlaybackTransport";

export type PlaybackControlsCardProps = {
  hasCurrentItem: boolean;
  currentItemLabel: string | null;
  /**
   * The single line under the title: composer, year, SID models, video standard, which tune, length.
   *
   * Built by `buildNowPlayingMetadataParts` so the order and the omission rules live in one tested
   * place rather than in this component's JSX. Supplied as labelled parts rather than as a finished
   * string because the composer is a control and the rest is text; joining first and splitting again
   * here would mean guessing at where the name ended, and composer names contain the separator's
   * neighbours often enough for that to be wrong.
   */
  currentItemMetadataParts?: NowPlayingMetadataSegment[];
  /**
   * What STIL says about this tune, where it says anything.
   *
   * Kept apart from `currentItemMetadata` because it is a different kind of fact. That line is the
   * SID header — what the file declares about itself. This is the archive's editors describing the
   * music: what this particular tune is called, who originally wrote it, and any note they left.
   * STIL covers under a third of the archive, so all three are usually absent and the card renders
   * exactly as it did before.
   */
  stil?: {
    title: string | null;
    originalArtist: string | null;
    note: string | null;
  };
  /**
   * Go and find more by this composer. Omitted where there is nothing to search — the card is also
   * rendered for playback from a device, where the archive is not involved.
   */
  onComposerSelected?: (composer: string) => void;
  /**
   * Open the list of tunes in this file.
   *
   * The same gesture as the composer beside it: "Tune 3 of 19" states that eighteen others exist,
   * and until now gave no way to reach any of them.
   */
  onTunesSelected?: () => void;
  canTransport: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  hasPlaylist: boolean;
  isPlaylistLoading: boolean;
  /** Stop was pressed during a launch that has not unwound yet; the button waits for it. */
  stopPending?: boolean;
  /** Stop's request to the device has not been answered yet. */
  stopping?: boolean;
  canPause: boolean;
  onPrevious: () => void;
  onPlay: () => void;
  onStop: () => void;
  onPauseResume: () => void;
  onNext: () => void;
  /**
   * Scrub the current tune by `deltaSeconds` (negative rewinds). Only supplied
   * when the active engine can seek — the C64 plays the SID itself, so there is
   * nothing to scrub there.
   */
  onSeek?: (deltaSeconds: number) => void;
  /** Hold started: capture the current position as the scrub origin. */
  onScrubStart?: () => void;
  /** One repeat tick of the hold — moves the scrub target, not the engine. */
  onScrubStep?: (deltaSeconds: number) => void;
  /** Finger lifted: land on the target. */
  onScrubEnd?: () => void;
  /** True while a hold is in progress (drives the scrubbing affordance). */
  isScrubbing?: boolean;
  /**
   * Jump straight to a fraction (0..1) of the tune. Only supplied for the
   * on-device engine — the C64 renders the SID itself and cannot be positioned.
   */
  onSeekToFraction?: (fraction: number) => void;
  /** Length of the tune, which turns a key press on the seek bar into seconds. */
  seekDurationMs?: number;
  /** The progress bar and the time labels follow it, so the clock moving re-renders only them. */
  timeline: PlaybackTimeline;
  /**
   * Everything shown about a seek that is waiting for the renderer, or undefined when none is.
   *
   * A seek past what is rendered cannot be instant — libsidplayfp cannot rewind — so playback holds
   * while the renderer catches up. Shown explicitly and determinately, because a listener who has
   * just dragged the bar must never be left wondering whether anything happened, and because a wait
   * with no end in sight is indistinguishable from a fault.
   */
  pendingSeek?: PendingSeekPresentation;
  /**
   * How much of the tune is already rendered, 0-100, or undefined when that is not a thing here.
   *
   * Only on-device playback has this: libsidplayfp cannot rewind, so reaching a position means
   * rendering everything before it. Shown as a translucent fill behind the played portion so the
   * listener can see how far a seek will land instantly, and see the renderer catching up when it
   * will not.
   */
  renderedPercent?: number;
  outputSelector?: ReactNode;
  volumeControls: ReactNode;
  shuffleSeed?: number | null;
  shuffleEnabled: boolean;
  onShuffleChange: (value: boolean) => void;
  repeatOneEnabled: boolean;
  onRepeatOneChange: (value: boolean) => void;
  repeatEnabled: boolean;
  onRepeatChange: (value: boolean) => void;
  /** SID Radio ambient ♥/✕ ranking affordance (spec §5.1); null when disabled. */
  rankingControls?: ReactNode;
  /**
   * The line that says where the queue comes from, drawn above everything else on the card.
   *
   * It leads because it is context for the rest: which station (or which playlist) is producing
   * this tune has to be readable before the tune's own details and long before the controls. The
   * slot is expected to occupy the same height in every state, so that starting or stopping a
   * station never moves the title or the transport underneath it.
   */
  stationIndicator?: (why: { expanded: boolean; onToggle: () => void }) => ReactNode;
  /** The station's explanation, drawn below the controls when the indicator's toggle opens it. */
  stationWhy?: string | null;
  /** True while a SID Radio station drives the queue — Shuffle offers to keep its queue as a regular playlist. */
  stationActive?: boolean;
};

/** Two lines of text-sm and never fewer than the 44 px a link inside it needs; longer text is clipped with an ellipsis. */
const RESERVED_METADATA_LINES =
  "h-11 min-w-0 self-stretch break-words text-sm leading-snug text-muted-foreground !overflow-clip [overflow-clip-margin:4px]";

export const PlaybackControlsCard = ({
  hasCurrentItem,
  currentItemLabel,
  currentItemMetadataParts = [],
  stil,
  onComposerSelected,
  onTunesSelected,
  canTransport,
  hasPrev,
  hasNext,
  isPlaying,
  isPaused,
  hasPlaylist,
  isPlaylistLoading,
  stopPending = false,
  stopping = false,
  canPause,
  onPrevious,
  onPlay,
  onStop,
  onPauseResume,
  onNext,
  onSeek,
  onScrubStart,
  onScrubStep,
  onScrubEnd,
  isScrubbing = false,
  onSeekToFraction,
  seekDurationMs,
  timeline,
  renderedPercent,
  pendingSeek,
  outputSelector,
  volumeControls,
  shuffleSeed,
  shuffleEnabled,
  onShuffleChange,
  repeatOneEnabled = false,
  onRepeatOneChange,
  repeatEnabled,
  onRepeatChange,
  rankingControls,
  stationIndicator,
  stationWhy,
  stationActive = false,
}: PlaybackControlsCardProps) => {
  const [stationWhyExpanded, setStationWhyExpanded] = useState(false);
  const creditsParts = currentItemMetadataParts.filter((part) => part.row === "credits");
  const factsParts = currentItemMetadataParts.filter((part) => part.row === "facts");
  // Credits clip the composer link's 44px target so it cannot cover the title.

  /**
   * One metadata segment, with its separator attached to its own end.
   *
   * The separator belongs to the segment before it so that a line break falls after the
   * "·" rather than before it. Rendering it in front of the following segment looks the
   * same while everything fits and strands a "·" at the start of the next line as soon as
   * it does not, which on a 320px screen is often.
   */
  const renderMetadataPart = (part: NowPlayingMetadataSegment, index: number, hasNext: boolean) => {
    const body =
      part.kind === "author" && onComposerSelected ? (
        <button
          type="button"
          className="hit-area-44-clipped z-[1] underline decoration-dotted underline-offset-2 hover:text-foreground"
          onClick={() => onComposerSelected(part.text)}
          data-testid="playback-current-composer"
          title={`Find more by ${part.text}`}
        >
          {part.text}
        </button>
      ) : part.kind === "tunes" && onTunesSelected ? (
        <button
          type="button"
          className="hit-area-44-clipped underline decoration-dotted underline-offset-2 hover:text-foreground"
          onClick={onTunesSelected}
          data-testid="playback-current-tunes"
          title="Choose a tune from this file"
        >
          {part.text}
        </button>
      ) : (
        part.text
      );
    return (
      <span key={`${part.kind}-${index}`}>
        <span className={part.row === "credits" ? "[overflow-wrap:anywhere]" : "whitespace-nowrap"}>
          {body}
          {hasNext ? NOW_PLAYING_METADATA_SEPARATOR.trimEnd() : null}
        </span>
        {hasNext ? " " : null}
      </span>
    );
  };

  const stilTuneLine = buildStilTuneLine({
    title: stil?.title ?? null,
    originalArtist: stil?.originalArtist ?? null,
  });
  const transportProps = {
    canTransport,
    hasPrev,
    hasNext,
    isPlaying,
    isPaused,
    hasPlaylist,
    isPlaylistLoading,
    stopPending,
    stopping,
    canPause,
    onPrevious: useStableCallback(onPrevious) as () => void,
    onPlay: useStableCallback(onPlay) as () => void,
    onStop: useStableCallback(onStop) as () => void,
    onPauseResume: useStableCallback(onPauseResume) as () => void,
    onNext: useStableCallback(onNext) as () => void,
    onSeek: useStableCallback(onSeek),
    onScrubStart: useStableCallback(onScrubStart),
    onScrubStep: useStableCallback(onScrubStep),
    onScrubEnd: useStableCallback(onScrubEnd),
    isScrubbing,
    onSeekToFraction: useStableCallback(onSeekToFraction),
    seekDurationMs,
    timeline,
    pendingSeek,
    renderedPercent,
  };
  const shuffleOn = !stationActive && shuffleEnabled;
  const repeatMode = repeatOneEnabled ? "tune" : repeatEnabled ? "playlist" : "off";
  const repeatOn = repeatMode !== "off";
  const shuffleFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-transport-shuffle",
    order: PLAY_TRANSPORT_FOCUS_ORDER.shuffle,
    group: "play-transport",
  });
  const repeatFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-transport-repeat",
    order: PLAY_TRANSPORT_FOCUS_ORDER.repeat,
    group: "play-transport",
  });

  return (
    <div className="flex flex-col items-stretch gap-3" data-testid="playback-controls-layout">
      {stationIndicator?.({
        expanded: stationWhyExpanded,
        onToggle: () => setStationWhyExpanded((value) => !value),
      })}
      <div
        className="grid w-full grid-cols-[minmax(0,1fr)_max-content_max-content] items-center gap-x-2"
        data-testid="playback-current-track"
      >
        <div className="col-span-3 mb-0.5 flex h-6 items-center overflow-clip text-xs text-muted-foreground">
          {hasCurrentItem ? (
            <>
              {/* The title now has the full width of the card to itself.

                It is still truncated rather than wrapped, so the card is exactly as tall for a
                forty-character HVSC name as for a short one and nothing below it — the metadata, the
                transport — moves between tunes. Truncation here is `text-overflow`, so the whole name
                is still in the document and is what a screen reader reads and what a pointer sees as
                the tooltip.

                The title starts at the left edge of the card, level with the metadata line under it.
                There used to be a small file-origin glyph in front of it, which indented it by its
                own width and left the two lines misaligned; where an item came from is in its
                playlist menu under Details. */}
              <div className="flex w-full flex-nowrap items-center">
                <span
                  className="min-w-0 flex-1 truncate text-base font-semibold text-foreground"
                  data-testid="playback-current-title"
                  title={currentItemLabel ?? undefined}
                >
                  {currentItemLabel}
                </span>
              </div>
            </>
          ) : (
            "Select a playlist item to start"
          )}
        </div>
        {/* Credits and facts belong immediately below the title, before the transport. */}
        <div className="contents text-xs text-muted-foreground" data-testid="playback-current-details">
          {/* Two metadata lines, and the actions sit on the second one rather than on a row of
                their own.

                Credits first - the author and the HVSC `released` value, which is one field
                holding both year and publisher and is printed whole. Then the facts: chip, video
                standard, which tune of how many, and how long. On a 320px screen that is the
                difference between three rows and two, and the row the actions used to occupy was
                otherwise empty.

                Each segment carries its own trailing separator inside a nowrap span, so a wrap
                happens after the separator rather than before it. Putting the separator in front
                of the following segment reads the same on one line but leaves a stranded "·" at
                the start of the next one as soon as the line is too narrow. */}
          <p
            className={cn(RESERVED_METADATA_LINES, "col-span-3 mb-1 line-clamp-2")}
            data-testid="playback-current-credits"
            title={creditsParts.map((part) => part.text).join(" · ") || undefined}
          >
            {creditsParts.map((part, index) => renderMetadataPart(part, index, index < creditsParts.length - 1))}
          </p>
          <div className="contents">
            {/* Clips the tunes link's hit area to this paragraph, which is never shorter than 44px when
                    that link is in it; the 4px margin keeps the keypad ring around the link visible. */}
            <p
              className={cn(RESERVED_METADATA_LINES, "line-clamp-2")}
              data-testid="playback-current-facts"
              title={factsParts.map((part) => part.text).join(" · ") || undefined}
            >
              {factsParts.map((part, index) => renderMetadataPart(part, index, index < factsParts.length - 1))}
            </p>
            {/* shrink-0 so the actions keep their 44px targets whatever the facts line does. */}
            {rankingControls ? (
              <div className="col-span-2 self-start" data-testid="playback-ranking-row">
                {rankingControls}
              </div>
            ) : null}
          </div>
        </div>
        <PlaybackTransport {...transportProps} />
        {outputSelector ? <div className="col-span-3 mt-3">{outputSelector}</div> : null}
        {/* One grid owns both button pairs, so wrapping metadata cannot move their columns. */}
        <div className="contents" data-testid="playback-volume-metadata-grid">
          <div className="mt-3 min-w-0">{volumeControls}</div>
          <div className="contents" role="group" aria-label="Playback order" data-testid="playback-order-controls">
            <Button
              ref={shuffleFocusRef}
              variant="outline"
              size="icon"
              className={cn(
                "relative mt-3 shrink-0 size-[44px] min-h-[44px] min-w-[44px] [&_svg]:size-[20px]",
                shuffleOn && "bg-accent text-accent-foreground",
              )}
              onClick={() => onShuffleChange(stationActive || !shuffleEnabled)}
              aria-label="Shuffle"
              aria-pressed={shuffleOn}
              title={`Shuffle: ${shuffleOn ? "on" : "off"}`}
              data-testid="playback-shuffle"
              data-shuffle-seed={shuffleSeed ?? ""}
            >
              <Shuffle aria-hidden="true" className="h-4 w-4" />
              {shuffleOn ? (
                <span aria-hidden="true" className="absolute bottom-1 size-1 rounded-full bg-current" />
              ) : null}
            </Button>
            <Button
              ref={repeatFocusRef}
              variant="outline"
              size="icon"
              className={cn(
                "relative mt-3 shrink-0 size-[44px] min-h-[44px] min-w-[44px] [&_svg]:size-[20px]",
                repeatOn && "bg-accent text-accent-foreground",
              )}
              data-testid="playback-repeat"
              aria-label={`Repeat: ${repeatMode}`}
              aria-pressed={repeatOn}
              title={`Repeat: ${repeatMode}`}
              onClick={() => {
                if (repeatOneEnabled) {
                  onRepeatOneChange(false);
                  onRepeatChange(false);
                } else if (repeatEnabled) {
                  onRepeatChange(false);
                  onRepeatOneChange(true);
                } else {
                  onRepeatChange(true);
                }
              }}
            >
              {repeatOneEnabled ? (
                <Repeat1 aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Repeat aria-hidden="true" className="h-4 w-4" />
              )}
              {repeatOn ? (
                <span aria-hidden="true" className="absolute bottom-1 size-1 rounded-full bg-current" />
              ) : null}
            </Button>
          </div>
        </div>
        {stationWhyExpanded && stationWhy ? (
          <div className="col-span-3 min-w-0">
            <SidRadioWhy text={stationWhy} />
          </div>
        ) : null}
        <div className="col-span-3 min-w-0">
          <TuneDetails tuneLine={stilTuneLine} note={stil?.note ?? null} />
        </div>
      </div>
    </div>
  );
};
