/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { addLog } from "@/lib/logging";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import {
  nextPoliteAnnouncement,
  PENDING_ANNOUNCEMENT_INTERVAL_MS,
  type PendingSeekPresentation,
  type PoliteAnnouncement,
} from "@/lib/playback/pendingSeekStatus";
import {
  buildStilTuneLine,
  NOW_PLAYING_METADATA_SEPARATOR,
  type NowPlayingMetadataSegment,
} from "@/lib/playback/nowPlayingMetadata";
import { TuneDetails } from "./TuneDetails";

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
  progressPercent: number;
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
  elapsedLabel: string;
  remainingLabel: string;
  totalLabel: string;
  remainingTotalLabel: string;
  volumeControls: ReactNode;
  shuffleEnabled: boolean;
  onShuffleChange: (value: boolean) => void;
  repeatEnabled: boolean;
  onRepeatChange: (value: boolean) => void;
  onReshuffle: () => void;
  reshuffleActive: boolean;
  reshuffleDisabled: boolean;
  shuffleSeed: number | null;
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
  stationIndicator?: ReactNode;
  /** True while a SID Radio station drives the queue — hides Shuffle/Repeat/Reshuffle (§5.3, principle 9). */
  stationActive?: boolean;
};

const PLAY_TRANSPORT_FOCUS_ORDER = {
  previous: 100,
  play: 110,
  pause: 120,
  next: 130,
  reshuffle: 180,
} as const;

/** How long Previous/Next must be held before it scrubs instead of skipping. */
const SEEK_HOLD_MS = 450;
/** How often it scrubs while held, and by how much. */
const SEEK_REPEAT_MS = 200;
const SEEK_STEP_SECONDS = 5;

/**
 * Hold Previous/Next to scrub the current tune; tap to change track.
 *
 * The two gestures share one button, so a hold must *suppress* the click that
 * follows it — otherwise letting go after scrubbing would also skip the track,
 * which is the opposite of what the user just asked for. `seeked` stays set
 * until the next press so the click handler (which fires after pointerup) can
 * still see it.
 */
/** Where along the bar the pointer is, as a fraction of its width. */
const fractionFromPointer = (event: ReactPointerEvent<HTMLElement>): number => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
};

/** Percentages arrive from a duration that may be an estimate, so pin them to the bar. */
const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * Hold `text` in a live region, but no more often than the announcement interval.
 *
 * The pending status refreshes twice a second. Handed straight to a live region that becomes a
 * screen reader talking over itself continuously, which drowns the rest of the page and tells the
 * listener less than saying it once every few seconds would. Clearing is immediate — a wait that has
 * ended must not keep being announced — and a message held back by the throttle is said when the
 * window opens rather than dropped, so the last state of a wait is always announced.
 */
const usePoliteAnnouncement = (text: string | null): string => {
  const [announcement, setAnnouncement] = useState<PoliteAnnouncement | null>(null);
  const announcementRef = useRef<PoliteAnnouncement | null>(null);
  announcementRef.current = announcement;

  useEffect(() => {
    const apply = (): PoliteAnnouncement | null => {
      const next = nextPoliteAnnouncement(announcementRef.current, text, Date.now());
      if (next !== announcementRef.current) setAnnouncement(next);
      return next;
    };
    const settled = apply();
    if (text === null || settled?.text === text) return;
    const waitMs = Math.max(0, PENDING_ANNOUNCEMENT_INTERVAL_MS - (Date.now() - (settled?.atMs ?? 0)));
    const timer = window.setTimeout(apply, waitMs);
    return () => window.clearTimeout(timer);
  }, [text]);

  return announcement?.text ?? "";
};

/** A short tick so a scrub is felt as well as seen; silently ignored where unsupported. */
const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Vibration is a nicety, never a requirement.
    void 0;
  }
};

const useHoldToSeek = (
  deltaSeconds: number,
  onSeek?: (deltaSeconds: number) => void,
  scrub?: { start?: () => void; step?: (deltaSeconds: number) => void; end?: () => void },
) => {
  const holdTimer = useRef<number | null>(null);
  const repeatTimer = useRef<number | null>(null);
  const seeked = useRef(false);
  // `stop` is created once, so it reads the latest callbacks through a ref.
  const scrubRef = useRef(scrub);
  scrubRef.current = scrub;

  const stop = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (repeatTimer.current !== null) {
      window.clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
    // Clear the suppression flag on the next tick — after the click that
    // follows this pointerup has been handled, but before anything else.
    //
    // Leaving it set until the next press would swallow a later activation that
    // produces no pointerdown to reset it: keyboard or keypad Enter on a focused
    // button raises `click` alone. That is not a corner case here — the C64U
    // Remote variant is keypad-first — and the symptom would be a Next button
    // that silently ignores every other press.
    if (seeked.current) {
      scrubRef.current?.end?.();
      window.setTimeout(() => {
        seeked.current = false;
      }, 0);
    }
  }, []);

  const start = useCallback(
    (event?: ReactPointerEvent<HTMLButtonElement>) => {
      if (!onSeek) return;
      seeked.current = false;
      // Keep receiving pointer events even if the finger drifts off a small icon
      // button, which would otherwise fire pointerleave and cancel the hold.
      // `hasPointerCapture` is the documented guard: capture throws only for a
      // pointer id that is no longer active, which this rules out without
      // swallowing anything.
      const target = event?.currentTarget;
      if (event?.pointerId !== undefined && target?.isConnected && !target.hasPointerCapture(event.pointerId)) {
        target.setPointerCapture(event.pointerId);
      }
      holdTimer.current = window.setTimeout(() => {
        seeked.current = true;
        addLog("debug", "Local SID hold-to-seek engaged", { deltaSeconds });
        // Scrubbing moves a TARGET that the UI follows immediately; the engine
        // is sent after it on its own cadence. Stepping the engine once per
        // repeat instead made the bar sit still until a rewind had finished
        // re-rendering, which reads as the control being broken.
        if (scrub?.start) {
          scrub.start();
          scrub.step?.(deltaSeconds);
          buzz(12);
          repeatTimer.current = window.setInterval(() => {
            scrub.step?.(deltaSeconds);
            buzz(8);
          }, SEEK_REPEAT_MS);
          return;
        }
        onSeek(deltaSeconds);
        repeatTimer.current = window.setInterval(() => onSeek(deltaSeconds), SEEK_REPEAT_MS);
      }, SEEK_HOLD_MS);
    },
    [deltaSeconds, onSeek],
  );

  // Never leave a timer running past unmount.
  useEffect(() => stop, [stop]);

  return { start, stop, consumedClick: () => seeked.current };
};

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
  progressPercent,
  renderedPercent,
  pendingSeek,
  elapsedLabel,
  remainingLabel,
  totalLabel,
  remainingTotalLabel,
  volumeControls,
  shuffleEnabled,
  onShuffleChange,
  repeatEnabled,
  onRepeatChange,
  onReshuffle,
  reshuffleActive,
  reshuffleDisabled,
  shuffleSeed,
  rankingControls,
  stationIndicator,
  stationActive = false,
}: PlaybackControlsCardProps) => {
  const creditsParts = currentItemMetadataParts.filter((part) => part.row === "credits");
  const factsParts = currentItemMetadataParts.filter((part) => part.row === "facts");

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
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          onClick={() => onComposerSelected(part.text)}
          data-testid="playback-current-composer"
          title={`Find more by ${part.text}`}
        >
          {part.text}
        </button>
      ) : part.kind === "tunes" && onTunesSelected ? (
        <button
          type="button"
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
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
        <span className="whitespace-nowrap">
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
  const pendingAnnouncement = usePoliteAnnouncement(pendingSeek?.liveText ?? null);
  const scrubHandlers = { start: onScrubStart, step: onScrubStep, end: onScrubEnd };
  const holdRewind = useHoldToSeek(-SEEK_STEP_SECONDS, onSeek, scrubHandlers);
  const holdForward = useHoldToSeek(SEEK_STEP_SECONDS, onSeek, scrubHandlers);

  const previousFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-transport-previous",
    order: PLAY_TRANSPORT_FOCUS_ORDER.previous,
    group: "play-transport",
    disabled: !canTransport || !hasPrev,
  });
  const playFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-transport-play",
    order: PLAY_TRANSPORT_FOCUS_ORDER.play,
    group: "play-transport",
    disabled: !hasPlaylist || isPlaylistLoading,
  });
  const pauseFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-transport-pause",
    order: PLAY_TRANSPORT_FOCUS_ORDER.pause,
    group: "play-transport",
    disabled: !canPause || isPlaylistLoading,
  });
  const nextFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-transport-next",
    order: PLAY_TRANSPORT_FOCUS_ORDER.next,
    group: "play-transport",
    disabled: !canTransport || !hasNext,
  });
  const reshuffleFocusRef = useFocusItem<HTMLButtonElement>({
    id: "play-transport-reshuffle",
    order: PLAY_TRANSPORT_FOCUS_ORDER.reshuffle,
    group: "play-transport",
    disabled: reshuffleDisabled || stationActive,
  });

  return (
    <div className="flex flex-col items-stretch gap-3" data-testid="playback-controls-layout">
      {stationIndicator}
      <div className="w-full text-xs text-muted-foreground" data-testid="playback-current-track">
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
                own width and left the two lines misaligned; where a tune came from is already shown
                against every row of the playlist. */}
            <div className="flex w-full flex-nowrap items-center">
              <span
                className="min-w-0 flex-1 truncate text-base font-semibold text-foreground"
                data-testid="playback-current-title"
                title={currentItemLabel ?? undefined}
              >
                {currentItemLabel}
              </span>
            </div>
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
            {creditsParts.length ? (
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground" data-testid="playback-current-credits">
                {creditsParts.map((part, index) => renderMetadataPart(part, index, index < creditsParts.length - 1))}
              </p>
            ) : null}
            {factsParts.length || rankingControls ? (
              <div className="mt-0.5 flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm leading-snug text-muted-foreground" data-testid="playback-current-facts">
                  {factsParts.map((part, index) => renderMetadataPart(part, index, index < factsParts.length - 1))}
                </p>
                {/* shrink-0 so the actions keep their 44px targets whatever the facts line does. */}
                {rankingControls ? (
                  <div className="flex shrink-0 items-center" data-testid="playback-ranking-row">
                    {rankingControls}
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* What STIL says about this tune, folded away by default.

                STIL is the archive's editorial record rather than the file's own header: what this
                particular tune is called, who wrote the music being arranged, and a note about it. A
                file called `Commando` playing tune 1 of 19 is told there that the tune is "BGM1" and
                that the music is Tamayo Kawamoto's, which the header cannot say — its author field
                names Rob Hubbard, who arranged it.

                All of it is worth reading and none of it is needed to identify the tune or to work
                the transport, so it is the part of the card that gives way on a small screen. See
                `TuneDetails` for the measurement. Nothing renders at all for the majority of the
                archive, which STIL does not cover. */}
            <TuneDetails tuneLine={stilTuneLine} note={stil?.note ?? null} />
          </>
        ) : (
          "Select a playlist item to start"
        )}
      </div>
      <div className="flex w-full flex-col gap-3" data-testid="playback-controls-stack">
        {/* Spread across the card rather than packed into four grid columns. The buttons are a fixed
            44 px, so in a `grid-cols-4` they sat at the left of cells that were wider than they
            were, and the row stopped 33 px short of the right edge — visibly ragged against the
            ranking pair directly above it, which is flush, and against the progress bar and the
            metadata line, which are flush too. Distributing them puts the first and last on the
            card's own edges, so every row of this card now starts and ends on the same two lines. */}
        {/*
          Centred, with only Play carrying a fill.
          Four equally-outlined buttons spread across the row gave the card no focal point: squinted
          at from a distance every one of them read the same, and the thing you press most was
          indistinguishable from the three you press rarely. Play is now a filled circle and the
          other three are ghosts, which is the media-player idiom and what the squint test rewards.
        */}
        <div className="flex items-center justify-center gap-1.5" data-testid="playback-transport-row">
          <Button
            ref={previousFocusRef}
            variant="ghost"
            size="icon"
            onClick={() => {
              // A hold already scrubbed; do not also change track.
              if (holdRewind.consumedClick()) return;
              onPrevious();
            }}
            onPointerDown={holdRewind.start}
            onPointerUp={holdRewind.stop}
            onPointerLeave={holdRewind.stop}
            onPointerCancel={holdRewind.stop}
            disabled={(!canTransport || !hasPrev) && !onSeek}
            id="playlist-prev"
            data-testid="playlist-prev"
            // Without this, Android hands a long press to the scroller and fires
            // pointercancel at roughly the hold threshold, so the gesture died on
            // a real finger while working under synthetic events.
            style={onSeek ? { touchAction: "none" } : undefined}
            aria-label="Previous"
            title={onSeek ? "Previous (hold to rewind)" : "Previous"}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            ref={playFocusRef}
            variant={isPlaying ? "destructive" : "default"}
            size="icon"
            className="size-14 rounded-full"
            onClick={isPlaying ? onStop : onPlay}
            disabled={!hasPlaylist || isPlaylistLoading}
            data-c64-persistent-active={isPlaying && !isPaused ? "true" : undefined}
            id="playlist-play"
            data-testid="playlist-play"
            aria-label={isPlaying ? "Stop" : "Play"}
            title={isPlaying ? "Stop" : "Play"}
          >
            {isPlaying ? <Square className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button
            ref={pauseFocusRef}
            variant="ghost"
            size="icon"
            onClick={onPauseResume}
            disabled={!canPause || isPlaylistLoading}
            id="playlist-pause"
            data-testid="playlist-pause"
            aria-label={isPaused ? "Resume" : "Pause"}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button
            ref={nextFocusRef}
            variant="ghost"
            size="icon"
            onClick={() => {
              // A hold already scrubbed; do not also change track.
              if (holdForward.consumedClick()) return;
              onNext();
            }}
            onPointerDown={holdForward.start}
            onPointerUp={holdForward.stop}
            onPointerLeave={holdForward.stop}
            onPointerCancel={holdForward.stop}
            disabled={(!canTransport || !hasNext) && !onSeek}
            id="playlist-next"
            data-testid="playlist-next"
            // Without this, Android hands a long press to the scroller and fires
            // pointercancel at roughly the hold threshold, so the gesture died on
            // a real finger while working under synthetic events.
            style={onSeek ? { touchAction: "none" } : undefined}
            aria-label="Next"
            title={onSeek ? "Next (hold to fast forward)" : "Next"}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn("shrink-0 tabular-nums", (isScrubbing || pendingSeek) && "font-semibold text-foreground")}
              data-testid="playback-elapsed"
              // Held, not merely lagging. While the renderer works towards a target the engine is
              // silent, and this clock stays at the last position that was genuinely audible. A
              // clock ticking on through that silence is the single thing this whole state exists
              // to prevent — it is indistinguishable from playback that has died.
              data-elapsed-held={pendingSeek ? "true" : undefined}
            >
              {pendingSeek ? `⏸ ${elapsedLabel}` : isScrubbing ? `⏵ ${elapsedLabel}` : elapsedLabel}
            </span>
            {onSeekToFraction ? (
              // A tap or drag anywhere on the bar moves the playback target there. Wrapped in a
              // button so it is reachable by keyboard and by the keypad-first C64U Remote variant,
              // where there is no pointer at all.
              //
              // Every pointer move is reported, and that is deliberate rather than an oversight of
              // "never seek on a gesture sample": the handler this calls does NOT seek per sample.
              // It moves the displayed target — which is what makes the bar follow the finger — and
              // debounces a single seek to where the finger came to rest. Withholding the samples
              // here would only make the bar lag the finger; the coalescing has to live where the
              // engine is driven, and it does.
              <button
                type="button"
                data-testid="playback-progress-seek"
                aria-label="Seek within the tune"
                className="flex-1 min-w-0 cursor-pointer py-2 -my-2 touch-none"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onSeekToFraction(fractionFromPointer(event));
                }}
                onPointerMove={(event) => {
                  // Only while the finger is actually down on this control.
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    onSeekToFraction(fractionFromPointer(event));
                  }
                }}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" ? 0.02 : event.key === "ArrowLeft" ? -0.02 : 0;
                  if (step === 0) return;
                  event.preventDefault();
                  onSeekToFraction(Math.min(1, Math.max(0, progressPercent / 100 + step)));
                }}
              >
                <div className="relative w-full">
                  {/* Behind the played portion, so the two read as one bar: solid where the tune has
                      played, translucent as far as it is rendered. */}
                  {/* Shown whenever the tune is not fully rendered — including, and especially, when
                      rendering is BEHIND the playhead. Hiding it then was backwards: that is exactly
                      the moment the listener needs to see the renderer catching up rather than wonder
                      whether playback has died. */}
                  {renderedPercent !== undefined && renderedPercent < 100 ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary/25"
                      style={{ width: `${Math.min(100, Math.max(0, renderedPercent))}%` }}
                      data-testid="playback-rendered-ahead"
                      data-rendered-percent={Math.round(renderedPercent)}
                    />
                  ) : null}
                  {/* The span still to be rendered, from the render head towards the target.
                      Striped as well as tinted: this app is read at arm's length, and one
                      translucent fill beside a slightly different translucent fill is not a
                      distinction anybody can make. The stripes march while the renderer works, and
                      stop under `prefers-reduced-motion` leaving the texture behind. */}
                  {pendingSeek ? (
                    <div
                      aria-hidden
                      className="playback-pending-region pointer-events-none absolute inset-y-0 rounded-full"
                      style={{
                        left: `${clampPercent(pendingSeek.renderedPercent)}%`,
                        width: `${Math.max(0, clampPercent(pendingSeek.targetPercent) - clampPercent(pendingSeek.renderedPercent))}%`,
                      }}
                      data-testid="playback-pending-region"
                      data-pending-progress={pendingSeek.progressPercent}
                      // Where the render head stood when the target was accepted — the denominator
                      // of the percentage beside it, and the one number a HIL session needs to tell
                      // a progress figure that is going somewhere from one that only looks like it.
                      data-started-percent={Math.round(pendingSeek.startedAtPercent)}
                    />
                  ) : null}
                  {/* Where the drag landed, while the renderer works towards it.
                      Named and dated rather than a bare line: a 2 px rule with no label is the one
                      element on this bar that a listener cannot interpret, and the position it
                      stands for is exactly the thing they are waiting to hear. */}
                  {pendingSeek ? (
                    <div
                      role="img"
                      aria-label={`Waiting to continue at ${pendingSeek.targetLabel}, ${pendingSeek.progressPercent}% ready`}
                      className="pointer-events-none absolute inset-y-0"
                      style={{ left: `${clampPercent(pendingSeek.targetPercent)}%` }}
                      data-testid="playback-awaited-marker"
                      data-awaited-percent={Math.round(pendingSeek.targetPercent)}
                    >
                      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-primary" />
                      {/* A distinct cap, so the target is a shape and not only a colour. */}
                      <span
                        aria-hidden
                        className="absolute -top-1 left-0 h-2 w-2 -translate-x-1/2 rotate-45 rounded-[1px] bg-primary"
                      />
                      <span
                        aria-hidden
                        className="absolute -top-5 left-0 -translate-x-1/2 whitespace-nowrap rounded-sm bg-primary px-1 text-xs font-medium leading-4 tabular-nums text-primary-foreground"
                        data-testid="playback-awaited-timestamp"
                      >
                        {pendingSeek.targetLabel}
                      </span>
                    </div>
                  ) : null}
                  <Progress
                    value={progressPercent}
                    className={cn(
                      "relative w-full bg-transparent transition-none",
                      isScrubbing && "ring-2 ring-primary/60",
                    )}
                    data-testid="playback-progress"
                    data-scrubbing={isScrubbing ? "true" : undefined}
                  />
                </div>
              </button>
            ) : (
              <Progress
                value={progressPercent}
                // Scrubbing gets its own look so the moving bar reads as "you are
                // dragging this", not as playback that has suddenly sped up.
                className={cn("flex-1 min-w-0 transition-none", isScrubbing && "ring-2 ring-primary/60")}
                data-testid="playback-progress"
                data-scrubbing={isScrubbing ? "true" : undefined}
              />
            )}
            <span className="shrink-0" data-testid="playback-remaining">
              {remainingLabel}
            </span>
          </div>
          {/* Inline and always visible, never a tooltip: there is no hover on a phone, and this is
              the only place that says why the tune has gone quiet. Determinate — a percentage and,
              once the device's render rate has actually been measured, a duration. */}
          {pendingSeek ? (
            <p
              // Hidden from assistive technology on purpose: the live region below says the same
              // thing in sentences, and exposing both makes a screen reader read the wait twice.
              aria-hidden
              className="text-xs font-medium text-foreground"
              data-testid="playback-pending-status"
              data-pending-progress={pendingSeek.progressPercent}
              data-pending-eta={pendingSeek.etaSeconds ?? undefined}
            >
              {pendingSeek.statusText}
            </p>
          ) : null}
          {/* Present whether or not anything is pending: a live region added to the DOM at the same
              moment as its content is frequently not announced at all. */}
          <span className="sr-only" aria-live="polite" data-testid="playback-pending-announcement">
            {pendingAnnouncement}
          </span>
          {/* Wraps, and each counter stays whole. At the largest Text size the two counters no
              longer fit one row, and the break landed inside the duration itself: an em dash is a
              break opportunity, so "—:—" was drawn as "—:" then "—". Stacking them keeps each
              reading as one value. */}
          <div
            className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground"
            data-testid="playback-counters"
          >
            <span className="whitespace-nowrap">Total: {totalLabel}</span>
            <span className="whitespace-nowrap">Remaining: {remainingTotalLabel}</span>
          </div>
        </div>
        {volumeControls}
        {/* The whole order row goes while a station drives the queue — removed, not greyed.

            A station is a mode, not a passing unavailability. The rule is to disable what will come
            back on its own and to remove what has no meaning in the current mode, and nothing the
            listener can do brings Shuffle, Repeat or Reshuffle back while a station runs: the
            station owns the order by definition, so they return only by stopping it. Greying is
            usually defended as teaching that a control exists, but that argument is paid for here by
            the source line at the top of the card, which names the station and carries Stop — and it
            was never actually being made, because the only explanation these controls carried was a
            `title` tooltip and there is no hover on the phone this ships to.

            The row holds nothing else. Recurse used to sit here and would have been left alone in an
            otherwise empty row; it is now in the Add items sheet, next to the folders it applies to.
            A radio station is something you listen to, so what is left on this card during one is
            the transport and the ranking pair, and the vertical space is given back rather than
            spent on controls that do nothing.

            Nothing above this moves: the row is the last thing in the card, so dropping it only
            shortens the card from the bottom. */}
        {stationActive ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <Checkbox
                checked={shuffleEnabled}
                onCheckedChange={(value) => onShuffleChange(Boolean(value))}
                aria-label="Shuffle"
                data-testid="playback-shuffle"
              />
              <span className="flex items-center gap-1">
                <Shuffle className="h-3.5 w-3.5" /> Shuffle
              </span>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <Checkbox
                checked={repeatEnabled}
                onCheckedChange={(value) => onRepeatChange(Boolean(value))}
                aria-label="Repeat"
                data-testid="playback-repeat"
              />
              <span className="flex items-center gap-1">
                <Repeat className="h-3.5 w-3.5" /> Repeat
              </span>
            </label>
            <Button
              ref={reshuffleFocusRef}
              variant="outline"
              size="sm"
              onClick={onReshuffle}
              disabled={reshuffleDisabled}
              id="playlist-reshuffle"
              data-testid="playlist-reshuffle"
              data-active={reshuffleActive ? "true" : "false"}
              // Non-destructive shuffle (HARD9-007) never reorders the visible
              // playlist, so the live seed of the next/prev order layer is
              // surfaced here as a diagnostic: a changed value proves Reshuffle
              // re-seeded the traversal without disturbing the curated list.
              data-shuffle-seed={shuffleSeed ?? ""}
              className={reshuffleActive ? "bg-accent text-accent-foreground" : undefined}
            >
              <Shuffle className="h-4 w-4 mr-1" />
              Reshuffle
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
