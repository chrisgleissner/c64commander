/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AUDIO_EQ_MAX_DB,
  AUDIO_EQ_MIN_DB,
  REVERB_PRESETS,
  STEREO_WIDTH_PRESETS,
  formatEqDb,
  isAudioProcessingActive,
  nearestPreset,
  resetAudioEq,
  saveAudioEqBand,
  saveAudioLevelling,
  saveAudioReverb,
  saveAudioStereoWidth,
  useAudioProcessing,
} from "@/lib/config/audioProcessingSettings";
import { useAudioFxAvailable } from "@/lib/audio/useAudioFxAvailable";
import { SettingsSection } from "./SettingsSection";

const EQ_BANDS = [
  { key: "bassDb", id: "bass", label: "Bass" },
  { key: "midDb", id: "mid", label: "Mid" },
  { key: "trebleDb", id: "treble", label: "Treble" },
] as const;

const GROUP_CLASS = "space-y-2 rounded-lg border border-border/70 p-3 min-w-0";

interface PresetRowProps {
  testIdPrefix: string;
  label: string;
  description: string;
  presets: readonly { id: string; label: string; value: number }[];
  value: number;
  onSelect: (value: number) => void;
}

const PresetRow = ({ testIdPrefix, label, description, presets, value, onSelect }: PresetRowProps) => {
  const selected = nearestPreset(presets, value);
  return (
    <div className={GROUP_CLASS} data-testid={testIdPrefix}>
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={label}>
        {presets.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            className="min-h-11 w-full"
            variant={selected.id === preset.id ? "default" : "outline"}
            aria-pressed={selected.id === preset.id}
            data-testid={`${testIdPrefix}-${preset.id}`}
            onClick={() => onSelect(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
};

/**
 * Settings: the optional processing applied to sound this phone plays. Everything is off until chosen,
 * and an effect that is off leaves the samples untouched. It is absent where the phone cannot process
 * its own sound, since there the controls would do nothing.
 */
export const AudioProcessingSettingsSection = () => {
  const available = useAudioFxAvailable();
  const params = useAudioProcessing();
  if (!available) return null;
  const eqChanged = params.bassDb !== 0 || params.midDb !== 0 || params.trebleDb !== 0;
  return (
    <SettingsSection
      id="audio-processing"
      title="Audio processing"
      summary="Normalize volume, equalizer, stereo width, reverb"
      icon={SlidersHorizontal}
      testId="settings-audio-processing"
      badge={isAudioProcessingActive(params) ? <span className="text-xs text-primary">On</span> : undefined}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground" data-testid="settings-audio-processing-scope">
          Applies to sound played on this phone, including your C64's sound when Live View plays it here.
        </p>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 p-3 min-w-0">
          <div className="min-w-0 flex-1">
            <Label htmlFor="settings-audio-levelling" className="flex min-h-11 items-center font-medium">
              Normalize volume
            </Label>
            <p className="text-xs text-muted-foreground">
              Keeps loud and quiet songs at a similar level, for listening in the evening.
            </p>
          </div>
          <Switch
            id="settings-audio-levelling"
            data-testid="settings-audio-levelling"
            checked={params.levelling}
            onCheckedChange={saveAudioLevelling}
            aria-label="Normalize volume"
          />
        </div>

        <div className={GROUP_CLASS} data-testid="settings-audio-eq">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Equalizer</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 min-w-[5.5rem]"
              disabled={!eqChanged}
              onClick={resetAudioEq}
              data-testid="settings-audio-eq-reset"
            >
              Reset
            </Button>
          </div>
          {EQ_BANDS.map((band) => (
            <div key={band.id} className="space-y-0.5" data-testid={`settings-audio-eq-${band.id}-row`}>
              <div className="flex items-center justify-between text-sm">
                <span id={`settings-audio-eq-${band.id}-label`}>{band.label}</span>
                <span className="tabular-nums text-muted-foreground" data-testid={`settings-audio-eq-${band.id}-value`}>
                  {formatEqDb(params[band.key])}
                </span>
              </div>
              <Slider
                className="h-11"
                min={AUDIO_EQ_MIN_DB}
                max={AUDIO_EQ_MAX_DB}
                step={1}
                value={[params[band.key]]}
                onValueChange={(values) => saveAudioEqBand(band.key, values[0] ?? 0)}
                aria-label={`${band.label} gain`}
                data-testid={`settings-audio-eq-${band.id}`}
                keypadFocusId={`settings-audio-eq-${band.id}`}
                keypadFocusGroup="settings-audio-eq"
              />
            </div>
          ))}
        </div>

        <PresetRow
          testIdPrefix="settings-audio-stereo"
          label="Stereo width"
          description="Spreads the mono SID sound across the speakers or headphones."
          presets={STEREO_WIDTH_PRESETS}
          value={params.stereoWidth}
          onSelect={saveAudioStereoWidth}
        />
        <PresetRow
          testIdPrefix="settings-audio-reverb"
          label="Reverb"
          description="Adds the sound of a room or a hall."
          presets={REVERB_PRESETS}
          value={params.reverb}
          onSelect={saveAudioReverb}
        />
      </div>
    </SettingsSection>
  );
};
