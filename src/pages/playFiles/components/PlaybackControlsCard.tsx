/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
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
import { TuneDetails } from "./TuneDetails";
import { PLAY_TRANSPORT_FOCUS_ORDER, PlaybackTransport } from "./PlaybackTransport";

export type PlaybackControlsCardProps = {
  hasCurrentItem: boolean;
  currentItemLabel: string | null;
  /**
   * Credits and facts under the title, from `buildNowPlayingMetadataParts`. Labelled parts rather
   * than one string because the composer and the tune count are controls and the rest is text.
   */
  currentItemMetadataParts?: NowPlayingMetadataSegment[];
  /** What STIL says about this tune; under a third of the archive has an entry, so usually all null. */
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
  /** Open the list of tunes in this file ("Tune 3 of 19"). */
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
   * A seek waiting for the renderer, or undefined. libsidplayfp cannot rewind, so playback holds
   * until the renderer catches up, and the wait is shown determinately so it never looks like a fault.
   */
  pendingSeek?: PendingSeekPresentation;
  /** How much of the tune is rendered, 0-100, for on-device playback only: a seek up to it lands instantly. */
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
  /** Where the queue comes from, drawn above everything else at the same height in every state. */
  stationIndicator?: ReactNode;
  /** True while a SID Radio station drives the queue — Shuffle offers to keep its queue as a regular playlist. */
  stationActive?: boolean;
};

/** Two line heights at every text size and at least the 44 px a link inside it needs; About this tune shows any clipped text. */
const RESERVED_METADATA_LINES =
  "h-[2lh] min-h-11 min-w-0 self-stretch break-words text-sm leading-snug text-muted-foreground !overflow-clip [overflow-clip-margin:4px]";

const joinedText = (parts: NowPlayingMetadataSegment[]): string | null =>
  parts.map((part) => part.text).join(NOW_PLAYING_METADATA_SEPARATOR) || null;

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
  stationActive = false,
}: PlaybackControlsCardProps) => {
  const creditsParts = currentItemMetadataParts.filter((part) => part.row === "credits");
  const factsParts = currentItemMetadataParts.filter((part) => part.row === "facts");

  /** One metadata segment with its separator attached to its own end, so a wrap falls after the "·". */
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
    onPrevious: useStableCallback(onPrevious, "onPrevious"),
    onPlay: useStableCallback(onPlay, "onPlay"),
    onStop: useStableCallback(onStop, "onStop"),
    onPauseResume: useStableCallback(onPauseResume, "onPauseResume"),
    onNext: useStableCallback(onNext, "onNext"),
    onSeek: useStableCallback(onSeek, "onSeek"),
    onScrubStart: useStableCallback(onScrubStart, "onScrubStart"),
    onScrubStep: useStableCallback(onScrubStep, "onScrubStep"),
    onScrubEnd: useStableCallback(onScrubEnd, "onScrubEnd"),
    isScrubbing,
    onSeekToFraction: useStableCallback(onSeekToFraction, "onSeekToFraction"),
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
      {stationIndicator}
      <div
        className="grid w-full grid-cols-[minmax(0,1fr)_max-content_max-content] items-center gap-x-2"
        data-testid="playback-current-track"
      >
        <div className="col-span-3 mb-0.5 flex h-6 items-center overflow-clip text-xs text-muted-foreground">
          {hasCurrentItem ? (
            <>
              {/* Truncated, not wrapped, so a long name never changes the card's height; the full name stays
                  in the document for screen readers and as the tooltip. */}
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
        <div className="contents text-xs text-muted-foreground" data-testid="playback-current-details">
          {/* Credits, then facts with the ranking actions beside them. Each segment carries its own
              trailing separator, so a wrap never strands a "·" at the start of a line. */}
          <p
            className={cn(RESERVED_METADATA_LINES, "col-span-3 mb-1 line-clamp-2")}
            data-testid="playback-current-credits"
            title={joinedText(creditsParts) ?? undefined}
          >
            {creditsParts.map((part, index) => renderMetadataPart(part, index, index < creditsParts.length - 1))}
          </p>
          <div className="contents">
            {/* The 4px clip margin keeps the keypad ring around the tunes link visible. */}
            <p
              className={cn(RESERVED_METADATA_LINES, "line-clamp-2")}
              data-testid="playback-current-facts"
              title={joinedText(factsParts) ?? undefined}
            >
              {factsParts.map((part, index) => renderMetadataPart(part, index, index < factsParts.length - 1))}
            </p>
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
        <div className="col-span-3 min-w-0">
          <TuneDetails
            available={hasCurrentItem}
            credits={joinedText(creditsParts)}
            facts={joinedText(factsParts)}
            tuneLine={stilTuneLine}
            note={stil?.note ?? null}
          />
        </div>
      </div>
    </div>
  );
};
