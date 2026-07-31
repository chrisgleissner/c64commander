/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  LOCAL_VOLUME_DEFAULT_INDEX,
  LOCAL_VOLUME_STEPS,
  localVolumeGainForIndex,
  localVolumeIndexForGain,
  localVolumeLabelForIndex,
} from "@/lib/playback/localPlaybackVolume";

describe("the volume scale on-device playback offers", () => {
  it("converts decibels to amplitude rather than counting slider positions", () => {
    // Loudness follows the logarithm of amplitude, which is what a decibel already is, and the ladder
    // is uneven — one decibel apart at the top and six apart at the bottom. Read as a linear fraction
    // of the slider's own length it would bear no relation to the figure printed beside it.
    const gainAt = (label: string) =>
      localVolumeGainForIndex(LOCAL_VOLUME_STEPS.findIndex((step) => step.label === label));

    expect(gainAt("0 dB")).toBeCloseTo(1, 6);
    expect(gainAt("-6 dB")).toBeCloseTo(0.501, 3);
    expect(gainAt("-12 dB")).toBeCloseTo(0.251, 3);
    expect(gainAt("-42 dB")).toBeCloseTo(0.0079, 4);
    expect(gainAt("OFF")).toBe(0);
  });

  it("never asks for more than unity, because a boost on a rendered signal would clip", () => {
    LOCAL_VOLUME_STEPS.forEach((_, index) => {
      expect(localVolumeGainForIndex(index)).toBeLessThanOrEqual(1);
      expect(localVolumeGainForIndex(index)).toBeGreaterThanOrEqual(0);
    });
  });

  it("starts at 0 dB, and reads a running engine back onto that step", () => {
    // Every step from 0 dB up asks for unity, so an engine playing at gain 1 must come back as 0 dB
    // rather than +6 dB, or the slider would open near the top of its travel for no reason.
    expect(localVolumeLabelForIndex(LOCAL_VOLUME_DEFAULT_INDEX)).toBe("0 dB");
    expect(localVolumeIndexForGain(1)).toBe(LOCAL_VOLUME_DEFAULT_INDEX);
    expect(localVolumeLabelForIndex(localVolumeIndexForGain(0.5))).toBe("-6 dB");
    expect(localVolumeLabelForIndex(localVolumeIndexForGain(0))).toBe("OFF");
  });

  it("has an unknown step read as silence rather than as full volume", () => {
    expect(localVolumeGainForIndex(LOCAL_VOLUME_STEPS.length)).toBe(0);
    expect(localVolumeLabelForIndex(LOCAL_VOLUME_STEPS.length)).toBe("—");
  });
});
