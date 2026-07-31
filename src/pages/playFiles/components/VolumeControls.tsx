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

/**
 * Mute and volume on one row: a speaker button, the slider, and the level in decibels.
 *
 * It used to be three lines — a labelled "Mute" button, the words "Playback volume" underneath it,
 * and the slider under those — and on the narrow display profile the button and the slider were
 * stacked as well. That is a lot of a phone screen for one control, on a page where the playlist
 * underneath is what people are actually looking at.
 *
 * Neither word is carrying anything. A speaker that crosses out when it is muted is the mute idiom
 * everywhere else a person plays music, and the decibel readout beside the slider already names what
 * the slider does, so a "Vol" caption would only take width away from the slider itself. Both words
 * survive where they are still needed: as the button's accessible name and title, which is also what
 * Android exposes as its content description.
 *
 * The row is the same height on every display profile, and it is deliberately built out of the same
 * pieces as the transport row above it — a 44 px icon button on the left, then the wide control.
 */
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
    <div className="flex items-center gap-3" data-testid="volume-row">
      <Button
        variant="outline"
        size="icon"
        onClick={onToggleMute}
        disabled={!canControlVolume}
        data-c64-persistent-active={volumeMuted ? "true" : undefined}
        data-testid="volume-mute"
        aria-label={volumeMuted ? "Unmute" : "Mute"}
        title={volumeMuted ? "Unmute" : "Mute"}
      >
        {volumeMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>
      <Slider
        min={0}
        max={Math.max(0, volumeStepsCount - 1)}
        step={1}
        value={[volumeSlider.sliderValue]}
        onValueChange={volumeSlider.onValueChange}
        onValueCommit={volumeSlider.onValueCommit}
        valueFormatter={volumeValueFormatter}
        disabled={!canControlVolume}
        // The row is shorter than it was, so the slider takes the full 44 px of it as its hit area
        // rather than only the 20 px the thumb occupies. On Android the transparent range input that
        // actually receives the touch is sized from this element, so this is the hit target.
        className="h-11 min-w-0 flex-1"
        data-testid="volume-slider"
        nativeInputMode={useNativeRangeInput ? "overlay" : "none"}
        nativeInputAriaLabel="Playback volume"
        nativeInputTestId={useNativeRangeInput ? "volume-slider-native-input" : undefined}
        aria-label="Playback volume"
        keypadFocusId="play-volume-slider"
        keypadFocusGroup="play-controls"
        keypadFocusOrder={60}
      />
      {/* Fixed width and tabular figures, so the row cannot reflow as the number changes: "-6 dB" and
          "-42 dB" must occupy the same space or the slider resizes under a finger that is dragging
          it. A transport row that moved while it was being touched has already cost this project a
          run of automated taps that landed on the wrong control. */}
      <span
        className="w-[52px] shrink-0 text-right text-xs tabular-nums text-muted-foreground"
        data-testid="volume-label"
      >
        {volumeLabel}
      </span>
    </div>
  );
};
