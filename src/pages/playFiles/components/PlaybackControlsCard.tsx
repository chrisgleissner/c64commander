/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { addLog } from "@/lib/logging";
import { useFocusItem } from "@/hooks/useFocusNavigation";

export type PlaybackControlsCardProps = {
  hasCurrentItem: boolean;
  currentItemIcon?: ReactNode;
  currentItemLabel: string | null;
  currentDurationLabel: string | null;
  subsongLabel: string | null;
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
  progressPercent: number;
  elapsedLabel: string;
  remainingLabel: string;
  totalLabel: string;
  remainingTotalLabel: string;
  volumeControls: ReactNode;
  recurseFolders: boolean;
  onRecurseChange: (value: boolean) => void;
  shuffleEnabled: boolean;
  onShuffleChange: (value: boolean) => void;
  repeatEnabled: boolean;
  onRepeatChange: (value: boolean) => void;
  onReshuffle: () => void;
  reshuffleActive: boolean;
  reshuffleDisabled: boolean;
  shuffleSeed: number | null;
  /** HARD12-017: one-tap entry to the remote input sheet, shown while playing. */
  openControllerAction?: ReactNode;
  /** SID Radio ambient ♥/✕ ranking affordance (spec §5.1); null when disabled. */
  rankingControls?: ReactNode;
  /** True while a SID Radio station drives the queue — disables Shuffle/Repeat (§5.3, principle 9). */
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
const useHoldToSeek = (deltaSeconds: number, onSeek?: (deltaSeconds: number) => void) => {
  const holdTimer = useRef<number | null>(null);
  const repeatTimer = useRef<number | null>(null);
  const seeked = useRef(false);

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
      if (event?.pointerId !== undefined) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is best-effort; the hold still works without it.
        }
      }
      holdTimer.current = window.setTimeout(() => {
        seeked.current = true;
        addLog("debug", "Local SID hold-to-seek engaged", { deltaSeconds });
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
  currentItemIcon,
  currentItemLabel,
  currentDurationLabel,
  subsongLabel,
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
  progressPercent,
  elapsedLabel,
  remainingLabel,
  totalLabel,
  remainingTotalLabel,
  volumeControls,
  recurseFolders,
  onRecurseChange,
  shuffleEnabled,
  onShuffleChange,
  repeatEnabled,
  onRepeatChange,
  onReshuffle,
  reshuffleActive,
  reshuffleDisabled,
  shuffleSeed,
  openControllerAction,
  rankingControls,
  stationActive = false,
}: PlaybackControlsCardProps) => {
  const holdRewind = useHoldToSeek(-SEEK_STEP_SECONDS, onSeek);
  const holdForward = useHoldToSeek(SEEK_STEP_SECONDS, onSeek);

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
    disabled: reshuffleDisabled,
  });

  return (
    <div className="flex flex-col items-stretch gap-3" data-testid="playback-controls-layout">
      <div className="w-full text-xs text-muted-foreground" data-testid="playback-current-track">
        {hasCurrentItem ? (
          <div className="flex flex-wrap items-center gap-1">
            {currentItemIcon ? <span className="shrink-0">{currentItemIcon}</span> : null}
            <span className="text-sm font-medium text-foreground">{currentItemLabel}</span>
            {currentDurationLabel ? (
              <span className="text-xs text-muted-foreground">({currentDurationLabel})</span>
            ) : null}
            {subsongLabel ? <span className="text-xs text-muted-foreground">{subsongLabel}</span> : null}
            {rankingControls ? <span className="ml-auto shrink-0">{rankingControls}</span> : null}
          </div>
        ) : (
          "Select a playlist item to start"
        )}
      </div>
      <div className="flex w-full flex-col gap-3" data-testid="playback-controls-stack">
        <div className="grid grid-cols-4 gap-2">
          <Button
            ref={previousFocusRef}
            variant="outline"
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
            onClick={isPlaying ? onStop : onPlay}
            disabled={!hasPlaylist || isPlaylistLoading}
            data-c64-persistent-active={isPlaying && !isPaused ? "true" : undefined}
            id="playlist-play"
            data-testid="playlist-play"
            aria-label={isPlaying ? "Stop" : "Play"}
            title={isPlaying ? "Stop" : "Play"}
          >
            {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            ref={pauseFocusRef}
            variant="outline"
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
            variant="outline"
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
            <span className="shrink-0" data-testid="playback-elapsed">
              {elapsedLabel}
            </span>
            <Progress value={progressPercent} className="flex-1 min-w-0" />
            <span className="shrink-0" data-testid="playback-remaining">
              {remainingLabel}
            </span>
          </div>
          <div
            className="flex items-center justify-between text-xs text-muted-foreground"
            data-testid="playback-counters"
          >
            <span>Total: {totalLabel}</span>
            <span>Remaining: {remainingTotalLabel}</span>
          </div>
        </div>
        {volumeControls}
        {openControllerAction}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={recurseFolders}
              onCheckedChange={(value) => onRecurseChange(Boolean(value))}
              aria-label="Recurse"
              data-testid="playback-recurse"
            />
            Recurse
          </label>
          <label
            className={cn("flex items-center gap-2 text-xs", stationActive && "opacity-50")}
            title={stationActive ? "Radio picks the order" : undefined}
          >
            <Checkbox
              checked={shuffleEnabled && !stationActive}
              disabled={stationActive}
              onCheckedChange={(value) => onShuffleChange(Boolean(value))}
              aria-label="Shuffle"
              data-testid="playback-shuffle"
            />
            <span className="flex items-center gap-1">
              <Shuffle className="h-3.5 w-3.5" /> Shuffle
            </span>
          </label>
          <label
            className={cn("flex items-center gap-2 text-xs", stationActive && "opacity-50")}
            title={stationActive ? "Radio picks the order" : undefined}
          >
            <Checkbox
              checked={repeatEnabled && !stationActive}
              disabled={stationActive}
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
            disabled={reshuffleDisabled || stationActive}
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
      </div>
    </div>
  );
};
