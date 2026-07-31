/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The scale the Play page's volume control offers while the tune is playing on this device.
 *
 * It is the Ultimate's own Audio Mixer ladder, written out here rather than read from the device.
 * That is the whole point: on-device playback has no device to ask. The control used to take its
 * steps from the connected Ultimate, so with nothing connected the slider had a single position, its
 * readout said "—", and every move resolved to a step that does not exist — which
 * {@link sidVolumeStepGain} scores as silence. A control that can only mute is worse than one that
 * does nothing.
 *
 * Reproducing the same ladder rather than inventing one keeps the two routes reading identically.
 * Somebody who has learnt that "-6 dB" is a comfortable evening level should not have to learn a
 * second scale because the sound is now coming out of the phone.
 */
import { buildSidVolumeSteps, sidVolumeStepGain, type SidVolumeOption } from "@/lib/config/sidVolumeControl";

/** Verbatim from a c64u's `Vol Socket 1` options, so the two routes offer the same choices. */
const LOCAL_VOLUME_OPTIONS = [
  "OFF",
  "+6 dB",
  "+5 dB",
  "+4 dB",
  "+3 dB",
  "+2 dB",
  "+1 dB",
  " 0 dB",
  "-1 dB",
  "-2 dB",
  "-3 dB",
  "-4 dB",
  "-5 dB",
  "-6 dB",
  "-7 dB",
  "-8 dB",
  "-9 dB",
  "-10 dB",
  "-11 dB",
  "-12 dB",
  "-13 dB",
  "-14 dB",
  "-15 dB",
  "-16 dB",
  "-17 dB",
  "-18 dB",
  "-24 dB",
  "-27 dB",
  "-30 dB",
  "-36 dB",
  "-42 dB",
];

/** Quietest first, as the slider runs: OFF, then -42 dB upwards. */
export const LOCAL_VOLUME_STEPS: SidVolumeOption[] = buildSidVolumeSteps(LOCAL_VOLUME_OPTIONS);

/**
 * The gain a step asks for, 0..1.
 *
 * Decibels, not the step's position in the list. The ladder is uneven — one decibel apart at the top
 * and six apart at the bottom — so a slider read as a linear fraction of its own length would bear no
 * relation to the figure printed beside it, and would also be the wrong shape for hearing: loudness
 * follows the logarithm of amplitude, which is what a decibel already is. Above 0 dB the gain clamps
 * to unity, because this is a digital gain on an already-rendered signal and boosting it would clip.
 */
export const localVolumeGainForIndex = (index: number): number => sidVolumeStepGain(LOCAL_VOLUME_STEPS[index]);

/** Where 0 dB sits — unity gain, and what a listener who has chosen nothing should get. */
export const LOCAL_VOLUME_DEFAULT_INDEX = Math.max(
  0,
  LOCAL_VOLUME_STEPS.findIndex((step) => step.numeric === 0),
);

/**
 * The step that best matches a gain the engine is already using.
 *
 * Used once, when the Play page mounts and asks the engine what level it is playing at. Every step
 * from 0 dB up asks for unity, so the search runs quietest-first and stops at the first match, which
 * lands on 0 dB rather than on +6 dB for a gain of 1.
 */
export const localVolumeIndexForGain = (gain: number): number => {
  let best = LOCAL_VOLUME_DEFAULT_INDEX;
  let bestDistance = Number.POSITIVE_INFINITY;
  LOCAL_VOLUME_STEPS.forEach((step, index) => {
    const distance = Math.abs(sidVolumeStepGain(step) - gain);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
};

/** The text beside the slider, e.g. "-6 dB". */
export const localVolumeLabelForIndex = (index: number): string => LOCAL_VOLUME_STEPS[index]?.label ?? "—";
