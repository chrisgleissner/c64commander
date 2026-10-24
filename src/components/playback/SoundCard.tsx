/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { SlidersHorizontal } from "lucide-react";

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { AmbianceBar, SoundBody, activeSoundName } from "@/components/sound/SoundPanel";
import { Switch } from "@/components/ui/switch";
import { useActivePlayback } from "@/hooks/useActivePlayback";
import { useAvMirror } from "@/hooks/useAvMirror";
import { useAudioFxAvailable } from "@/lib/audio/useAudioFxAvailable";
import { saveAudioEnabled, useAudioProcessingRecord } from "@/lib/config/audioProcessingSettings";

export const SOUND_ON_C64_MESSAGE = "Your C64 is playing this sound, so these settings do not apply to it.";

export interface SoundCardProps {
  /** The C64 or a connected Ultimate is producing the sound, and this phone is not. */
  c64Plays: boolean;
}

/**
 * Tone curve, ambiance presets and sound options for the sound this phone plays. It exists only where the
 * native plugin can process sound, like the Spectrum card, and is disabled while the C64 plays the sound.
 */
export const SoundCard = ({ c64Plays }: SoundCardProps) => {
  const available = useAudioFxAvailable();
  const record = useAudioProcessingRecord();
  if (!available) return null;
  return (
    <CollapsibleSection
      scope="play"
      id="sound"
      title="Sound"
      summary="Tone curve and ambiance for the sound from this phone"
      icon={SlidersHorizontal}
      testId="play-section-sound"
      badge={
        <span className="text-sm text-primary" data-testid="sound-active-name">
          {activeSoundName(record)}
        </span>
      }
      actions={
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <span data-testid="sound-switch-label">{record.enabled ? "On" : "Off"}</span>
          <Switch
            checked={record.enabled}
            disabled={c64Plays}
            onCheckedChange={saveAudioEnabled}
            aria-label="Sound processing"
            data-testid="sound-switch"
          />
        </label>
      }
      peek={
        <div className="space-y-1">
          {c64Plays ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="sound-unavailable">
              {SOUND_ON_C64_MESSAGE}
            </p>
          ) : null}
          <AmbianceBar record={record} disabled={c64Plays} />
        </div>
      }
    >
      <SoundBody record={record} disabled={c64Plays} />
    </CollapsibleSection>
  );
};

/** Follows the source actually playing: the card is disabled while only the C64 makes the sound. */
export const PlaybackSoundCard = () => {
  const playback = useActivePlayback();
  const mirror = useAvMirror();
  return <SoundCard c64Plays={playback.remote && !playback.local && !mirror.audioLive} />;
};
