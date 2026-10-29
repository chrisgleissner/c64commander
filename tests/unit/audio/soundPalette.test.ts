/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { describe, expect, it } from "vitest";

import { TONE_BAND_HZ } from "@/lib/audio/tone/toneCurve";
import {
  AMBIANCE_HUES,
  EFFECT_ACCENTS,
  PITCH_STOPS,
  SOUND_SURFACES,
  contrastRatio,
  pitchColor,
  soundAccent,
  type ThemeMode,
} from "@/lib/audio/tone/soundPalette";

const MODES: ThemeMode[] = ["light", "dark"];
const TEXT_RATIO = 4.5;
const PITCHES = [...new Set([...TONE_BAND_HZ, ...PITCH_STOPS.map((stop) => stop.hz)])];

describe("Sound card colors keep their contrast against the card", () => {
  it.each(MODES)(
    "draws every pitch, used for the curve and the selected band's label, as text in the %s theme",
    (mode) => {
      for (const hz of PITCHES) {
        expect(contrastRatio(pitchColor(hz, mode), SOUND_SURFACES[mode]), `${hz} Hz`).toBeGreaterThanOrEqual(
          TEXT_RATIO,
        );
      }
    },
  );

  it.each(MODES)(
    "draws every ambiance accent as text in the %s theme, with readable ink on the filled chip",
    (mode) => {
      for (const id of Object.keys(AMBIANCE_HUES)) {
        const { accent, onAccent } = soundAccent(id);
        expect(contrastRatio(accent[mode], SOUND_SURFACES[mode]), id).toBeGreaterThanOrEqual(TEXT_RATIO);
        expect(contrastRatio(onAccent[mode], accent[mode]), `${id} ink`).toBeGreaterThanOrEqual(TEXT_RATIO);
      }
    },
  );

  it.each(MODES)("draws both effect sliders as text in the %s theme", (mode) => {
    for (const [effect, pair] of Object.entries(EFFECT_ACCENTS)) {
      expect(contrastRatio(pair[mode], SOUND_SURFACES[mode]), effect).toBeGreaterThanOrEqual(TEXT_RATIO);
    }
  });

  it("gives every ambiance its own accent", () => {
    for (const mode of MODES) {
      const ids = Object.keys(AMBIANCE_HUES).filter((id) => id !== "off");
      expect(new Set(ids.map((id) => soundAccent(id).accent[mode])).size).toBe(ids.length);
    }
  });
});
