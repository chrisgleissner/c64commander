/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { activeSoundName } from "@/components/sound/SoundPanel";
import { useAudioFxAvailable } from "@/lib/audio/useAudioFxAvailable";
import { useAudioProcessingRecord } from "@/lib/config/audioProcessingSettings";
import { requestSectionOpen, writeSectionState } from "@/lib/ui/collapsibleSectionStore";
import { SettingsSection } from "./SettingsSection";

/**
 * Settings: where the sound controls are. They live on the Play page, in the Sound card, so they can be
 * heard and seen working; this section names the current sound and opens the card. It is absent where the
 * phone cannot process its own sound, since there the card does not exist either.
 */
export const AudioProcessingSettingsSection = () => {
  const available = useAudioFxAvailable();
  const record = useAudioProcessingRecord();
  const navigate = useNavigate();
  if (!available) return null;
  const openCard = () => {
    writeSectionState("play", "sound", true);
    navigate("/play");
    requestSectionOpen("play", "sound");
  };
  return (
    <SettingsSection
      id="audio-processing"
      title="Sound"
      summary="Tone curve, ambiance, normalize volume, stereo width, reverb"
      icon={SlidersHorizontal}
      testId="settings-audio-processing"
      badge={
        <span className="text-sm text-primary" data-testid="settings-audio-processing-state">
          {record.enabled ? activeSoundName(record) : "Off"}
        </span>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="settings-audio-processing-scope">
          Applies to sound played on this phone, including your C64's sound when Live View plays it here. The controls
          are in the Sound card on the Play page.
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full text-sm"
          onClick={openCard}
          data-testid="settings-audio-open-card"
        >
          Open the Sound card
        </Button>
      </div>
    </SettingsSection>
  );
};
