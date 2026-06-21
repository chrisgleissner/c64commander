/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { createNumericSliderDomain, useDeviceBoundSlider } from "@/hooks/useDeviceBoundSlider";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

export type VolumeControlsProps = {
  volumeMuted: boolean;
  canControlVolume: boolean;
  onToggleMute: () => void;
  volumeStepsCount: number;
  volumeIndex: number;
  onVolumeDraftChange: (value: number) => void;
  onVolumePreview: (value: number) => Promise<void> | void;
  onVolumeCommit: (value: number) => Promise<void> | void;
  previewIntervalMs: number;
  volumeLabel: string;
  volumeValueFormatter?: (value: number) => string;
  useNativeRangeInput?: boolean;
};

export const VolumeControls = ({
  volumeMuted,
  canControlVolume,
  onToggleMute,
  volumeStepsCount,
  volumeIndex,
  onVolumeDraftChange,
  onVolumePreview,
  onVolumeCommit,
  previewIntervalMs,
  volumeLabel,
  volumeValueFormatter,
  useNativeRangeInput = false,
}: VolumeControlsProps) => {
  const { profile } = useDisplayProfile();
  const volumeSlider = useDeviceBoundSlider({
    deviceValue: volumeIndex,
    domain: createNumericSliderDomain({ min: 0, max: Math.max(0, volumeStepsCount - 1), round: Math.round }),
    previewMode: "commitOnly",
    preview: onVolumePreview,
    commit: onVolumeCommit,
    previewThrottleMs: previewIntervalMs,
    onDraftChange: onVolumeDraftChange,
  });

  return (
    <div className={profile === "compact" ? "flex flex-col items-stretch gap-3" : "flex flex-wrap items-center gap-3"}>
      <Button
        variant="outline"
        size="sm"
        className="min-w-[96px] justify-center"
        onClick={onToggleMute}
        disabled={!canControlVolume}
        data-c64-persistent-active={volumeMuted ? "true" : undefined}
        data-testid="volume-mute"
        aria-label={volumeMuted ? "Unmute" : "Mute"}
      >
        {volumeMuted ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />}
        {volumeMuted ? "Unmute" : "Mute"}
      </Button>
      <div
        className={
          profile === "expanded"
            ? "flex min-w-[200px] flex-1 flex-col gap-1"
            : "flex min-w-[160px] flex-1 flex-col gap-1"
        }
      >
        <span className="text-[11px] text-muted-foreground" data-testid="volume-caption">
          Playback volume
        </span>
        <div className="flex items-center gap-3">
          <Slider
            min={0}
            max={Math.max(0, volumeStepsCount - 1)}
            step={1}
            value={[volumeSlider.sliderValue]}
            onValueChange={volumeSlider.onValueChange}
            onValueCommit={volumeSlider.onValueCommit}
            valueFormatter={volumeValueFormatter}
            disabled={!canControlVolume}
            data-testid="volume-slider"
            nativeInputMode={useNativeRangeInput ? "overlay" : "none"}
            nativeInputAriaLabel="Playback volume"
            nativeInputTestId={useNativeRangeInput ? "volume-slider-native-input" : undefined}
            aria-label="Playback volume"
            keypadFocusId="play-volume-slider"
            keypadFocusGroup="play-controls"
            keypadFocusOrder={60}
          />
          <span className="text-xs text-muted-foreground w-[52px] text-right" data-testid="volume-label">
            {volumeLabel}
          </span>
        </div>
      </div>
    </div>
  );
};
