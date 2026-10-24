/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Loader2, Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addLog } from "@/lib/logging";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { CENTER_VERB_ATTR } from "@/lib/input";
import {
  nextPoliteAnnouncement,
  PENDING_ANNOUNCEMENT_INTERVAL_MS,
  type PendingSeekPresentation,
  type PoliteAnnouncement,
} from "@/lib/playback/pendingSeekStatus";
import {
  readShownPlaybackTime,
  ShownPlaybackCounters,
  ShownPlaybackProgress,
  ShownPlaybackTime,
} from "./ShownPlaybackTime";
import type { PlaybackControlsCardProps } from "./PlaybackControlsCard";

export const PLAY_TRANSPORT_FOCUS_ORDER = {
  previous: 100,
  play: 110,
  pause: 120,
  next: 130,
  shuffle: 160,
  repeat: 170,
} as const;

/** How long Previous/Next must be held before it scrubs instead of skipping. */
const SEEK_HOLD_MS = 450;
/** How often it scrubs while held, and by how much. */
const SEEK_REPEAT_MS = 200;
const SEEK_STEP_SECONDS = 5;
const SEEK_KEY_REPEAT_STEP_SECONDS = 15;
const SEEK_KEY_FALLBACK_FRACTION = 0.02;

/** How far one Left/Right press on the focused seek bar moves it, as a fraction of the tune; a held key moves further. */
export const seekKeyStepFraction = (durationMs: number | undefined, repeat: boolean): number => {
  const seconds = repeat ? SEEK_KEY_REPEAT_STEP_SECONDS : SEEK_STEP_SECONDS;
  return durationMs ? (seconds * 1000) / durationMs : SEEK_KEY_FALLBACK_FRACTION * (seconds / SEEK_STEP_SECONDS);
};

/** Where along the bar the pointer is, as a fraction of its width. */
const fractionFromPointer = (event: ReactPointerEvent<HTMLElement>): number => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
};

/** Percentages arrive from a duration that may be an estimate, so pin them to the bar. */
const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * Hold `text` in a live region, but no more often than the announcement interval, so a status that
 * refreshes twice a second does not make a screen reader talk over itself. Clearing is immediate, and
 * a message held back by the throttle is said when the window opens rather than dropped.
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
    if (settled === null || settled.text === text) return;
    const waitMs = Math.max(0, PENDING_ANNOUNCEMENT_INTERVAL_MS - (Date.now() - settled.atMs));
    const timer = window.setTimeout(apply, waitMs);
    return () => window.clearTimeout(timer);
  }, [text]);

  return announcement?.text ?? "";
};

/** A short tick so a scrub is felt as well as seen, where vibration is available. */
const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch (error) {
    addLog("warn", "Seek vibration failed", {
      durationMs: ms,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
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
    // A hold suppresses the click that follows its pointerup; clear the flag on the next tick, after
    // that click. Keeping it until the next press would swallow Enter on a keypad-first device, which
    // raises `click` with no pointerdown to reset it.
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

export type PlaybackTransportProps = Pick<
  PlaybackControlsCardProps,
  | "canTransport"
  | "hasPrev"
  | "hasNext"
  | "isPlaying"
  | "isPaused"
  | "hasPlaylist"
  | "isPlaylistLoading"
  | "stopPending"
  | "stopping"
  | "canPause"
  | "onPrevious"
  | "onPlay"
  | "onStop"
  | "onPauseResume"
  | "onNext"
  | "onSeek"
  | "onScrubStart"
  | "onScrubStep"
  | "onScrubEnd"
  | "isScrubbing"
  | "onSeekToFraction"
  | "seekDurationMs"
  | "timeline"
  | "pendingSeek"
  | "renderedPercent"
>;

const samePendingSeek = (a: PendingSeekPresentation | undefined, b: PendingSeekPresentation | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    Object.keys(a).every((key) => Object.is(a[key as keyof typeof a], b[key as keyof typeof b])));

const sameTransportProps = (a: PlaybackTransportProps, b: PlaybackTransportProps) =>
  (Object.keys(a) as (keyof PlaybackTransportProps)[]).every((key) =>
    key === "pendingSeek" ? samePendingSeek(a.pendingSeek, b.pendingSeek) : Object.is(a[key], b[key]),
  );

export const PlaybackTransport = memo(
  ({
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
    pendingSeek,
    renderedPercent,
  }: PlaybackTransportProps) => {
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
    // A launch can take twenty seconds (a disk whose settings file is applied through the device menu),
    // and the listener must be able to call it off rather than wait for it to finish.
    const stopAvailable = isPlaying || (isPlaylistLoading && !stopPending);
    const playButtonLabel = stopping ? "Stopping…" : stopAvailable ? "Stop" : "Play";
    const playFocusRef = useFocusItem<HTMLButtonElement>({
      id: "play-transport-play",
      order: PLAY_TRANSPORT_FOCUS_ORDER.play,
      group: "play-transport",
      disabled: !hasPlaylist,
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
    return (
      <div className="col-span-3 mt-3 flex w-full flex-col gap-3" data-testid="playback-controls-stack">
        {/* Centered, with only Play filled and the other three ghosts, so the most-used control stands out. */}
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
            variant={stopping || stopAvailable ? "destructive" : "default"}
            size="icon"
            className="size-14 rounded-full"
            // aria-disabled rather than disabled while a Stop is pending, so the focus ring keeps its place.
            onClick={stopping || stopPending ? undefined : stopAvailable ? onStop : onPlay}
            disabled={!hasPlaylist}
            aria-disabled={stopping || stopPending || undefined}
            data-c64-persistent-active={isPlaying && !isPaused ? "true" : undefined}
            data-stopping={stopping ? "true" : undefined}
            id="playlist-play"
            data-testid="playlist-play"
            aria-label={playButtonLabel}
            title={playButtonLabel}
          >
            {stopping ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : stopAvailable ? (
              <Square className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
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
              className={cn("shrink-0 tabular-nums", (isScrubbing || pendingSeek) && "text-foreground")}
              data-testid="playback-elapsed"
              // Held, not merely lagging. While the renderer works towards a target the engine is
              // silent, and this clock stays at the last position that was genuinely audible. A
              // clock ticking on through that silence is the single thing this whole state exists
              // to prevent — it is indistinguishable from playback that has died.
              data-elapsed-held={pendingSeek ? "true" : undefined}
            >
              {/* Always the same width, so the bar does not move sideways under a finger that starts a drag. */}
              <span className="inline-block w-[1.25em]">{pendingSeek ? "⏸" : isScrubbing ? "⏵" : ""}</span>
              <span className="inline-block min-w-[5ch]">
                <ShownPlaybackTime timeline={timeline} field="elapsedLabel" />
              </span>
            </span>
            {onSeekToFraction ? (
              // A button so the keypad can reach it. Every pointer move moves the displayed target only;
              // the handler debounces a single seek to where the finger came to rest.
              <button
                type="button"
                data-key-nav-horizontal=""
                {...{ [CENTER_VERB_ATTR]: "Adjust" }}
                data-testid="playback-progress-seek"
                aria-label="Seek within the tune"
                className="flex-1 min-w-0 min-h-11 cursor-pointer py-2 -my-2 touch-none"
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
                  const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                  if (direction === 0) return;
                  event.preventDefault();
                  // The shown position follows the pending target, so held keys accumulate and the
                  // controller seeks once, after the keys stop.
                  const { progressPercent } = readShownPlaybackTime(timeline);
                  const step = direction * seekKeyStepFraction(seekDurationMs, event.repeat);
                  onSeekToFraction(Math.min(1, Math.max(0, progressPercent / 100 + step)));
                }}
              >
                <div className="relative w-full">
                  {/* The empty track, always drawn: the progress element is transparent so the rendered
                      span can show through it, which left nothing visible to aim at while a tune was
                      still being rendered. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full border border-border bg-secondary"
                    data-testid="playback-track"
                  />
                  {/* Behind the played portion: solid where played, translucent as far as rendered. Shown
                      whenever rendering is incomplete, especially when it is behind the playhead. */}
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
                      aria-label={pendingSeek.markerLabel}
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
                  <ShownPlaybackProgress
                    timeline={timeline}
                    className={cn(
                      "relative w-full bg-transparent transition-none",
                      isScrubbing && "ring-2 ring-primary/60",
                    )}
                    aria-label="Playback progress"
                    data-testid="playback-progress"
                    data-scrubbing={isScrubbing ? "true" : undefined}
                  />
                </div>
              </button>
            ) : (
              <ShownPlaybackProgress
                timeline={timeline}
                // Scrubbing gets its own look so the moving bar reads as "you are
                // dragging this", not as playback that has suddenly sped up.
                className={cn("flex-1 min-w-0 transition-none", isScrubbing && "ring-2 ring-primary/60")}
                aria-label="Playback progress"
                data-testid="playback-progress"
                data-scrubbing={isScrubbing ? "true" : undefined}
              />
            )}
            <span className="min-w-[6ch] shrink-0 text-right tabular-nums" data-testid="playback-remaining">
              <ShownPlaybackTime timeline={timeline} field="remainingLabel" />
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
          <ShownPlaybackCounters
            timeline={timeline}
            className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground"
            data-testid="playback-counters"
          />
          {stopping ? (
            <p
              role="status"
              className="text-center text-sm font-medium text-foreground"
              data-testid="playback-stop-status"
            >
              Stopping…
            </p>
          ) : null}
        </div>
      </div>
    );
  },
  sameTransportProps,
);
