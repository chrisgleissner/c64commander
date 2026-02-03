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
  onVolumeCommit: (value: number) => void;
  onVolumeInteraction: () => void;
  volumeLabel: string;
};

export const VolumeControls = ({
  volumeMuted,
  canControlVolume,
  isPending,
  onToggleMute,
  volumeStepsCount,
  volumeIndex,
  onVolumeChange,
  onVolumeCommit,
  onVolumeInteraction,
  volumeLabel,
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
    <div className="flex flex-1 items-center gap-3 min-w-[160px] sm:min-w-[200px]">
      <Slider
        min={0}
        max={Math.max(0, volumeStepsCount - 1)}
        step={1}
        value={[volumeIndex]}
        onValueChange={onVolumeChange}
        onValueCommit={(value) => onVolumeCommit(value[0] ?? 0)}
        onPointerDown={onVolumeInteraction}
        disabled={!canControlVolume}
        data-testid="volume-slider"
      />
      <span className="text-xs text-muted-foreground w-[52px] text-right" data-testid="volume-label">{volumeLabel}</span>
    </div>
  </div>
);
