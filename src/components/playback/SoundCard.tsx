/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { SlidersHorizontal } from "lucide-react";

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { SoundBody, collapsedSoundName, soundAccentId } from "@/components/sound/SoundPanel";
import { Switch } from "@/components/ui/switch";
import { useActivePlayback } from "@/hooks/useActivePlayback";
import { useAvMirror } from "@/hooks/useAvMirror";
import { accentVars, soundAccent } from "@/lib/audio/tone/soundPalette";
import { useAudioFxAvailable } from "@/lib/audio/useAudioFxAvailable";
import { saveAudioEnabled, useAudioProcessingRecord } from "@/lib/config/audioProcessingSettings";
import { cn } from "@/lib/utils";

export { SOUND_ON_C64_MESSAGE } from "@/components/sound/SoundPanel";

export interface SoundCardProps {
  /** The C64 or a connected Ultimate is producing the sound, and this phone is not. */
  c64Plays: boolean;
  /** This phone is playing sound, so the live spectrum can be drawn behind the curve. */
  soundOnPhone?: boolean;
}

/**
 * Tone curve, ambiance presets and sound options for the sound this phone plays. It exists only where the
 * native plugin can process sound, like the Spectrum card, and is disabled while the C64 plays the sound.
 * Closed, it is one row: the accent dot, "Sound", the active sound and the switch.
 */
export const SoundCard = ({ c64Plays, soundOnPhone = false }: SoundCardProps) => {
  const available = useAudioFxAvailable();
  const record = useAudioProcessingRecord();
  if (!available) return null;
  const accentId = soundAccentId(record);
  return (
    <div className="snd-scope" style={accentVars(soundAccent(accentId))} data-sound-accent={accentId}>
      <CollapsibleSection
        scope="play"
        id="sound"
        title="Sound"
        summary="Tone curve and ambiance for the sound from this phone"
        icon={SlidersHorizontal}
        leading={
          <span
            aria-hidden="true"
            className="ml-0.5 size-2.5 shrink-0 rounded-full bg-[var(--snd-accent)] shadow-[0_0_0_3px_hsl(var(--card)),0_0_0_4px_var(--snd-accent)]"
            data-testid="sound-accent-dot"
          />
        }
        badgeTruncates
        className="snd-card"
        testId="play-section-sound"
        badge={
          <span
            className={cn(
              "block truncate font-medium",
              record.enabled ? "text-[var(--snd-accent)]" : "text-muted-foreground",
            )}
            data-testid="sound-active-name"
          >
            {collapsedSoundName(record)}
          </span>
        }
        actions={
          <Switch
            checked={record.enabled}
            disabled={c64Plays}
            onCheckedChange={saveAudioEnabled}
            aria-label="Sound processing"
            className="data-[state=checked]:bg-[var(--snd-accent)]"
            thumbClassName="data-[state=checked]:bg-[var(--snd-on-accent)]"
            data-testid="sound-switch"
          />
        }
      >
        <SoundBody record={record} disabled={c64Plays} soundOnPhone={soundOnPhone} />
      </CollapsibleSection>
    </div>
  );
};

/** Follows the source actually playing: the card is disabled while only the C64 makes the sound. */
export const PlaybackSoundCard = () => {
  const playback = useActivePlayback();
  const mirror = useAvMirror();
  return (
    <SoundCard
      c64Plays={playback.remote && !playback.local && !mirror.audioLive}
      soundOnPhone={playback.local || mirror.audioLive}
    />
  );
};
