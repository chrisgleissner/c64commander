/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ResponsivePathText } from "@/components/ResponsivePathText";
import { formatDurationSeconds, sliderToDurationSeconds } from "../playFilesUtils";

export type PlaybackSettingsPanelProps = {
  durationSliderMax: number;
  durationSliderValue: number;
  durationInput: string;
  onDurationSliderChange: (value: number[]) => void;
  onDurationSliderCommit: (value: number[]) => void;
  onDurationInputChange: (value: string) => void;
  onDurationInputBlur: () => void;
  onChooseSonglengthsFile: () => void;
  activeSonglengthsPath: string | null;
  songlengthsName: string | null;
  songlengthsSizeLabel: string | null;
  songlengthsEntryCount: number | null;
  songlengthsError: string | null;
};

export const PlaybackSettingsPanel = ({
  durationSliderMax,
  durationSliderValue,
  durationInput,
  onDurationSliderChange,
  onDurationSliderCommit,
  onDurationInputChange,
  onDurationInputBlur,
  onChooseSonglengthsFile,
  activeSonglengthsPath,
  songlengthsName,
  songlengthsSizeLabel,
  songlengthsEntryCount,
  songlengthsError,
}: PlaybackSettingsPanelProps) => {
  const songlengthsMetadata = [
    songlengthsEntryCount !== null ? `${songlengthsEntryCount} entries` : null,
    songlengthsSizeLabel,
  ]
    .filter(Boolean)
    .join(", ");
  const songlengthsPath = activeSonglengthsPath ?? songlengthsName;

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Default duration</p>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-1 min-w-[160px]">
            <Slider
              min={0}
              max={durationSliderMax}
              step={1}
              value={[durationSliderValue]}
              onValueChange={onDurationSliderChange}
              onValueCommit={onDurationSliderCommit}
              valueFormatter={(value) => formatDurationSeconds(sliderToDurationSeconds(value))}
              data-testid="duration-slider"
            />
          </div>
          <Input
            value={durationInput}
            onChange={(event) => onDurationInputChange(event.target.value)}
            onBlur={onDurationInputBlur}
            inputMode="numeric"
            maxLength={5}
            placeholder="mm:ss"
            className="w-[84px] text-right"
            data-testid="duration-input"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Songlengths file</p>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-2">
          <div className="min-w-0 flex-1 space-y-1">
            {songlengthsPath ? (
              <ResponsivePathText
                path={songlengthsPath}
                mode="start-and-filename"
                className="text-xs font-semibold text-primary"
                dataTestId="songlengths-path-label"
              />
            ) : (
              <p className="text-xs text-muted-foreground">Not selected.</p>
            )}
            {songlengthsPath && (songlengthsSizeLabel || songlengthsEntryCount !== null) ? (
              <p className="text-xs text-muted-foreground">{songlengthsMetadata}</p>
            ) : null}
          </div>
          <Button variant="outline" size="sm" onClick={onChooseSonglengthsFile}>
            Change
          </Button>
        </div>
        {songlengthsError ? <p className="text-xs text-destructive">{songlengthsError}</p> : null}
      </div>
    </>
  );
};
