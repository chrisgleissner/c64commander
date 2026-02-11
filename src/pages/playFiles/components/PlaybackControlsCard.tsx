/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from 'react';
import { Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';

export type PlaybackControlsCardProps = {
  hasCurrentItem: boolean;
  currentItemLabel: string | null;
  currentDurationLabel: string | null;
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
};

export const PlaybackControlsCard = ({
  hasCurrentItem,
  currentItemLabel,
  currentDurationLabel,
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
}: PlaybackControlsCardProps) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="text-xs text-muted-foreground" data-testid="playback-current-track">
      {hasCurrentItem ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm font-medium text-foreground">{currentItemLabel}</span>
          {currentDurationLabel ? (
            <span className="text-xs text-muted-foreground">({currentDurationLabel})</span>
          ) : null}
        </div>
      ) : (
        'Select a playlist item to start'
      )}
    </div>
    <div className="flex flex-col gap-3 w-full sm:w-auto">
      <div className="grid grid-cols-4 gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onPrevious}
          disabled={!canTransport || !hasPrev}
          id="playlist-prev"
          data-testid="playlist-prev"
          aria-label="Previous"
          title="Previous"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant={isPlaying ? 'destructive' : 'default'}
          size="icon"
          onClick={isPlaying ? onStop : onPlay}
          disabled={!hasPlaylist || isPlaylistLoading}
          id="playlist-play"
          data-testid="playlist-play"
          aria-label={isPlaying ? 'Stop' : 'Play'}
          title={isPlaying ? 'Stop' : 'Play'}
        >
          {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onPauseResume}
          disabled={!canPause || isPlaylistLoading}
          id="playlist-pause"
          data-testid="playlist-pause"
          aria-label={isPaused ? 'Resume' : 'Pause'}
          title={isPaused ? 'Resume' : 'Pause'}
        >
          {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onNext}
          disabled={!canTransport || !hasNext}
          id="playlist-next"
          data-testid="playlist-next"
          aria-label="Next"
          title="Next"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0" data-testid="playback-elapsed">{elapsedLabel}</span>
          <Progress value={progressPercent} className="flex-1 min-w-0" />
          <span className="shrink-0" data-testid="playback-remaining">{remainingLabel}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground" data-testid="playback-counters">
          <span>Total: {totalLabel}</span>
          <span>Remaining: {remainingTotalLabel}</span>
        </div>
      </div>
      {volumeControls}
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
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={shuffleEnabled}
            onCheckedChange={(value) => onShuffleChange(Boolean(value))}
            aria-label="Shuffle"
            data-testid="playback-shuffle"
          />
          <span className="flex items-center gap-1"><Shuffle className="h-3.5 w-3.5" /> Shuffle</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={repeatEnabled}
            onCheckedChange={(value) => onRepeatChange(Boolean(value))}
            aria-label="Repeat"
            data-testid="playback-repeat"
          />
          <span className="flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> Repeat</span>
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={onReshuffle}
          disabled={reshuffleDisabled}
          id="playlist-reshuffle"
          data-testid="playlist-reshuffle"
          data-active={reshuffleActive ? 'true' : 'false'}
          className={reshuffleActive ? 'bg-accent text-accent-foreground' : undefined}
        >
          <Shuffle className="h-4 w-4 mr-1" />
          Reshuffle
        </Button>
      </div>
    </div>
  </div>
);
