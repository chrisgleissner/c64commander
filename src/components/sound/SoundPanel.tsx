/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { ChevronLeft, ChevronRight, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChipRow } from "@/components/sound/ChipRow";
import { SegmentedAmount } from "@/components/sound/SegmentedAmount";
import { ToneCurveEditor } from "@/components/sound/ToneCurveEditor";
import { UserPresets } from "@/components/sound/UserPresets";
import { TONE_PRESETS, activeTonePreset } from "@/lib/audio/tone/toneCurve";
import {
  REVERB_PRESETS,
  STEREO_WIDTH_PRESETS,
  activeSoundPreset,
  allSoundPresets,
  applySoundPreset,
  backToPreviousSound,
  saveAudioBands,
  saveAudioLevelling,
  saveAudioReverb,
  saveAudioStereoWidth,
  stepSoundPreset,
  type AudioProcessingRecord,
} from "@/lib/config/audioProcessingSettings";

export const CUSTOM_SOUND_NAME = "Custom";

export const activeSoundName = (record: AudioProcessingRecord): string =>
  activeSoundPreset(record)?.label ?? CUSTOM_SOUND_NAME;

interface PanelProps {
  record: AudioProcessingRecord;
  disabled: boolean;
}

const ARROW_CLASS = "min-h-11 min-w-11 shrink-0 px-0";

/** The always-visible quick switches: previous and next sound, the ambiance chips, and back to the last sound. */
export const AmbianceBar = ({ record, disabled }: PanelProps) => {
  const active = activeSoundPreset(record);
  return (
    <div className="space-y-1" data-testid="sound-ambiance">
      <div className="flex items-center">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={ARROW_CLASS}
          disabled={disabled}
          aria-label="Previous sound"
          onClick={() => stepSoundPreset(-1)}
          data-testid="sound-prev"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Button>
        <ChipRow
          className="flex-1"
          chips={allSoundPresets(record)}
          activeId={active?.id}
          onSelect={applySoundPreset}
          ariaLabel="Ambiance"
          testIdPrefix="sound-chip"
          disabled={disabled}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={ARROW_CLASS}
          disabled={disabled}
          aria-label="Next sound"
          onClick={() => stepSoundPreset(1)}
          data-testid="sound-next"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="min-h-11 text-sm"
        disabled={disabled || record.previous === null}
        onClick={backToPreviousSound}
        data-testid="sound-back"
      >
        <Undo2 className="mr-1.5 h-4 w-4" aria-hidden />
        Back to previous sound
      </Button>
    </div>
  );
};

/** The detailed controls: tone curve, tone presets, normalize volume, stereo width, reverb and saved sounds. */
export const SoundBody = ({ record, disabled }: PanelProps) => {
  const { sound } = record;
  return (
    <div className="min-w-0 space-y-3" data-testid="sound-body">
      <div className="min-w-0 space-y-2 rounded-lg border border-border/70 p-3">
        <Label className="text-sm font-medium">Tone</Label>
        <ToneCurveEditor bandsDb={sound.bandsDb} onChange={saveAudioBands} disabled={disabled} />
        <ChipRow
          className="-mx-3"
          chips={TONE_PRESETS}
          activeId={activeTonePreset(sound.bandsDb)?.id}
          onSelect={(id) => saveAudioBands(TONE_PRESETS.find((preset) => preset.id === id)?.bandsDb ?? [])}
          ariaLabel="Tone presets"
          testIdPrefix="sound-tone-preset"
          disabled={disabled}
        />
      </div>
      <SegmentedAmount
        testIdPrefix="sound-levelling"
        label="Normalize volume"
        description="Keeps loud and quiet songs at a similar level, for listening in the evening."
        choices={[
          { id: "off", label: "Off", value: 0 },
          { id: "on", label: "On", value: 1 },
        ]}
        value={sound.levelling ? 1 : 0}
        onSelect={(value) => saveAudioLevelling(value === 1)}
        disabled={disabled}
      />
      <SegmentedAmount
        testIdPrefix="sound-stereo"
        label="Stereo width"
        description="Spreads the mono SID sound across the speakers or headphones."
        choices={STEREO_WIDTH_PRESETS}
        value={sound.stereoWidth}
        onSelect={saveAudioStereoWidth}
        fineTune={{ max: 100 }}
        disabled={disabled}
      />
      <SegmentedAmount
        testIdPrefix="sound-reverb"
        label="Reverb"
        description="Adds the sound of a room or a hall."
        choices={REVERB_PRESETS}
        value={sound.reverb}
        onSelect={saveAudioReverb}
        fineTune={{ max: 100 }}
        disabled={disabled}
      />
      <UserPresets record={record} disabled={disabled} />
    </div>
  );
};
