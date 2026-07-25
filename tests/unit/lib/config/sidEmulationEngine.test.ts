import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SID_EMULATION_ENGINE, loadSidEmulationEngine, saveSidEmulationEngine } from "@/lib/config/appSettings";
import { variant } from "@/generated/variant";

/**
 * The engine default is a device-capability decision, backed by measurement, so
 * it is worth pinning rather than leaving to whoever edits variants.yaml next.
 *
 * Measured like-for-like on identical tunes (docs/plans/sid-station/AUDIO-FIDELITY-TEST.md):
 *   reSIDfp   4.3x realtime  — ~39% of one core on a Pixel 4, 0 underruns
 *   SIDLite  23.8x realtime  — ~5.5x cheaper, but audibly not a C64
 *
 * The keypad variant targets the Callback 8020 (MediaTek Helio G81, Cortex-A75
 * @2.0 GHz), roughly 2-3x slower single-threaded than the Pixel 4's Snapdragon
 * 855, which puts reSIDfp at or past realtime there.
 */
describe("SID emulation engine setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("follows the active build variant's default", () => {
    expect(DEFAULT_SID_EMULATION_ENGINE).toBe(
      variant.runtime.defaultSidEmulationEngine === "sidlite" ? "sidlite" : "residfp",
    );
  });

  it("defaults to the accurate engine unless the variant asks otherwise", () => {
    // Sounding like a C64 is the point of playing a SID, so accuracy is the
    // default everywhere the device can afford it.
    if (variant.runtime.defaultSidEmulationEngine !== "sidlite") {
      expect(DEFAULT_SID_EMULATION_ENGINE).toBe("residfp");
    }
  });

  it("uses the default when nothing is stored", () => {
    expect(loadSidEmulationEngine()).toBe(DEFAULT_SID_EMULATION_ENGINE);
  });

  it("round-trips an explicit choice", () => {
    saveSidEmulationEngine("sidlite");
    expect(loadSidEmulationEngine()).toBe("sidlite");
    saveSidEmulationEngine("residfp");
    expect(loadSidEmulationEngine()).toBe("residfp");
  });

  it("falls back to the default rather than trusting an unknown stored value", () => {
    localStorage.setItem("c64u_sid_emulation_engine", "reSID-turbo-9000");
    expect(loadSidEmulationEngine()).toBe(DEFAULT_SID_EMULATION_ENGINE);
  });
});
