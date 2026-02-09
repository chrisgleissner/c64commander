import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

export type VolumeControlsProps = {
  volumeMuted: boolean;
  canControlVolume: boolean;
  isPending: boolean;
  onToggleMute: () => void;
  volumeStepsCount: number;
  volumeIndex: number;
  onVolumeChange: (value: number[]) => void;
  onVolumeChangeAsync: (value: number) => void;
  onVolumeCommit: (value: number) => void;
  volumeLabel: string;
  volumeValueFormatter?: (value: number) => string;
};

export const VolumeControls = ({
  volumeMuted,
  canControlVolume,
  isPending,
  onToggleMute,
  volumeStepsCount,
  volumeIndex,
  onVolumeChange,
  onVolumeChangeAsync,
  onVolumeCommit,
  volumeLabel,
  volumeValueFormatter,
}: VolumeControlsProps) => (
  <div className="flex flex-wrap items-center gap-3">
    <Button
      variant="outline"
      size="sm"
      className="min-w-[96px] justify-center"
      onClick={onToggleMute}
      disabled={!canControlVolume}
      data-testid="volume-mute"
    >
      {volumeMuted ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />}
      {volumeMuted ? 'Unmute' : 'Mute'}
    </Button>
    <div className="flex flex-1 min-w-[160px] sm:min-w-[200px] flex-col gap-1">
      <span className="text-[11px] text-muted-foreground" data-testid="volume-caption">Playback volume</span>
      <div className="flex items-center gap-3">
        <Slider
          min={0}
          max={Math.max(0, volumeStepsCount - 1)}
          step={1}
          value={[volumeIndex]}
          onValueChange={onVolumeChange}
          onValueChangeAsync={onVolumeChangeAsync}
          onValueCommitAsync={onVolumeCommit}
          valueFormatter={volumeValueFormatter}
          disabled={!canControlVolume}
          data-testid="volume-slider"
        />
        <span className="text-xs text-muted-foreground w-[52px] text-right" data-testid="volume-label">{volumeLabel}</span>
      </div>
    </div>
  </div>
);
