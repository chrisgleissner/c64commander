/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useId, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Info, Undo2 } from "lucide-react";

import "./sound.css";
import { ChipRow } from "@/components/sound/ChipRow";
import { NotchedSlider } from "@/components/sound/NotchedSlider";
import { ToneCurveEditor } from "@/components/sound/ToneCurveEditor";
import { UserPresets } from "@/components/sound/UserPresets";
import { Switch } from "@/components/ui/switch";
import { TONE_BAND_HZ, TONE_PRESETS, activeTonePreset } from "@/lib/audio/tone/toneCurve";
import { EFFECT_ACCENTS, pitchPair, soundAccent, toneLeaning, type ThemePair } from "@/lib/audio/tone/soundPalette";
import { useSpectrumBackdrop } from "@/lib/audio/spectrum/useSpectrumBackdrop";
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
import { cn } from "@/lib/utils";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

export const CUSTOM_SOUND_NAME = "Custom";
export const OFF_SOUND_NAME = "Off";
export const SOUND_ON_C64_MESSAGE = "Your C64 is playing this sound, so these settings do not apply to it.";

export const activeSoundName = (record: AudioProcessingRecord): string =>
  activeSoundPreset(record)?.label ?? CUSTOM_SOUND_NAME;

/** What the closed card reads: the active sound, or "Off" while processing is switched off. */
export const collapsedSoundName = (record: AudioProcessingRecord): string =>
  record.enabled ? activeSoundName(record) : OFF_SOUND_NAME;

/** Which accent the card wears: the built-in ambiance's own, the custom one for anything else, a neutral one when off. */
export const soundAccentId = (record: AudioProcessingRecord): string => {
  if (!record.enabled) return "off";
  const active = activeSoundPreset(record);
  return active && !active.id.startsWith("user-") ? active.id : "custom";
};

/** Negative margins that take a row to the card's edges, matching the body padding of each profile. */
const useBleed = () => (useDisplayProfile().profile === "compact" ? "-mx-3" : "-mx-4");

const ambianceAccent = (id: string): ThemePair => soundAccent(id.startsWith("user-") ? "custom" : id).accent;

const toneAccent = (id: string): ThemePair | null => {
  const preset = TONE_PRESETS.find((candidate) => candidate.id === id);
  const leaning = preset ? toneLeaning(TONE_BAND_HZ, preset.bandsDb) : null;
  return leaning === null ? null : pitchPair(leaning);
};

interface PanelProps {
  record: AudioProcessingRecord;
  disabled: boolean;
}

const ARROW_CLASS =
  "flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-40";

const Group = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <section
    className="min-w-0 space-y-2 border-t border-foreground/[0.07] pt-4 first:border-t-0 first:pt-0"
    data-testid={testId}
  >
    {children}
  </section>
);

/** Previous and next sound, the ambiance chips, and back to the last sound. */
export const AmbianceBar = ({ record, disabled }: PanelProps) => {
  const active = activeSoundPreset(record);
  const bleed = useBleed();
  return (
    <div className="min-w-0 space-y-1" data-testid="sound-ambiance">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h3 className="text-base font-medium">Ambiance</h3>
        <button
          type="button"
          className="-mr-2 flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-40"
          disabled={disabled || record.previous === null}
          onClick={backToPreviousSound}
          aria-label="Back to previous sound"
          data-testid="sound-back"
        >
          <Undo2 className="size-4" aria-hidden />
          Previous
        </button>
      </div>
      <div className={cn("flex items-center", bleed)}>
        <button
          type="button"
          className={ARROW_CLASS}
          disabled={disabled}
          aria-label="Previous sound"
          onClick={() => stepSoundPreset(-1)}
          data-testid="sound-prev"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <ChipRow
          className="flex-1 px-1"
          chips={allSoundPresets(record)}
          activeId={active?.id}
          onSelect={applySoundPreset}
          accentFor={ambianceAccent}
          ariaLabel="Ambiance"
          testIdPrefix="sound-chip"
          disabled={disabled}
        />
        <button
          type="button"
          className={ARROW_CLASS}
          disabled={disabled}
          aria-label="Next sound"
          onClick={() => stepSoundPreset(1)}
          data-testid="sound-next"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
};

const NormalizeRow = ({ record, disabled }: PanelProps) => {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3" data-testid="sound-levelling-row">
      <label htmlFor={id} className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-base font-medium">Normalize volume</span>
        <span className="block text-sm text-muted-foreground">Loud and quiet songs play at a similar level.</span>
      </label>
      <Switch
        id={id}
        checked={record.sound.levelling}
        disabled={disabled}
        onCheckedChange={saveAudioLevelling}
        className="data-[state=checked]:bg-[var(--snd-accent)]"
        thumbClassName="data-[state=checked]:bg-[var(--snd-on-accent)]"
        data-testid="sound-levelling"
      />
    </div>
  );
};

/** The detailed controls: ambiance, tone curve, tone presets, normalize volume, stereo width, reverb and saved sounds. */
export const SoundBody = ({ record, disabled, soundOnPhone = false }: PanelProps & { soundOnPhone?: boolean }) => {
  const { sound } = record;
  const spectrum = useSpectrumBackdrop(soundOnPhone && !disabled);
  const bleed = useBleed();
  return (
    <div className="min-w-0 space-y-4" data-testid="sound-body">
      {disabled ? (
        <p
          className="flex items-start gap-2 rounded-lg bg-foreground/[0.05] px-3 py-2.5 text-base text-muted-foreground"
          role="status"
          data-testid="sound-unavailable"
        >
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
          {SOUND_ON_C64_MESSAGE}
        </p>
      ) : null}
      <div className={cn("min-w-0 space-y-4", disabled && "opacity-60 grayscale")}>
        <Group>
          <AmbianceBar record={record} disabled={disabled} />
        </Group>
        <Group testId="sound-tone">
          <ToneCurveEditor
            bandsDb={sound.bandsDb}
            onChange={saveAudioBands}
            disabled={disabled}
            spectrum={spectrum}
            animate
          />
          <ChipRow
            className={cn(bleed, "pt-2")}
            chips={TONE_PRESETS}
            activeId={activeTonePreset(sound.bandsDb)?.id}
            onSelect={(id) => saveAudioBands(TONE_PRESETS.find((preset) => preset.id === id)?.bandsDb ?? [])}
            accentFor={toneAccent}
            ariaLabel="Tone presets"
            testIdPrefix="sound-tone-preset"
            disabled={disabled}
          />
        </Group>
        <Group>
          <NormalizeRow record={record} disabled={disabled} />
        </Group>
        <Group testId="sound-effects">
          <div className="space-y-1">
            <NotchedSlider
              label="Stereo width"
              notches={STEREO_WIDTH_PRESETS}
              value={sound.stereoWidth}
              onChange={saveAudioStereoWidth}
              accent={EFFECT_ACCENTS.stereoWidth}
              disabled={disabled}
              testIdPrefix="sound-stereo"
            />
            <NotchedSlider
              label="Reverb"
              notches={REVERB_PRESETS}
              value={sound.reverb}
              onChange={saveAudioReverb}
              accent={EFFECT_ACCENTS.reverb}
              disabled={disabled}
              testIdPrefix="sound-reverb"
            />
          </div>
        </Group>
        <Group>
          <UserPresets record={record} disabled={disabled} />
        </Group>
      </div>
    </div>
  );
};
