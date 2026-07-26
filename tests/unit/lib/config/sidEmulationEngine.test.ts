import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SID_EMULATION_ENGINE, loadSidEmulationEngine, saveSidEmulationEngine } from "@/lib/config/appSettings";
import { variant } from "@/generated/variant";

/**
 * Every variant defaults to the accurate engine, and that is worth pinning:
 * the cheap one is a real, audible downgrade, so switching a variant's default
 * to it must be a deliberate act backed by a measurement on that device.
 *
 * Measured like-for-like (docs/plans/sid-station/AUDIO-FIDELITY-TEST.md §6.3a):
 *   reSIDfp   4.3x realtime  — ~39% of one core on a Pixel 4, 0 underruns
 *   SIDLite  23.8x realtime  — ~5.5x cheaper, but audibly not a C64
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

  it("defaults to the accurate engine on every shipped variant", () => {
    // No variant may quietly ship the lesser engine. The keypad variant targets
    // the unreleased Callback 8020; defaulting it to SIDLite on a spec-sheet
    // projection would degrade the hardware that exists to protect hardware that
    // does not. Change this only alongside a measurement on the real device.
    expect(variant.runtime.defaultSidEmulationEngine).toBe("residfp");
    expect(DEFAULT_SID_EMULATION_ENGINE).toBe("residfp");
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
