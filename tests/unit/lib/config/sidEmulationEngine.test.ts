import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SID_EMULATION_ENGINE, loadSidEmulationEngine, saveSidEmulationEngine } from "@/lib/config/appSettings";
import { variant } from "@/generated/variant";
import { DEFAULT_VARIANTS_PATH, parseVariantSource } from "../../../../scripts/generate-variant.mjs";

/**
 * The default emulation is a per-edition decision and is worth pinning: SIDLite is audibly not a C64,
 * so only an edition whose target hardware cannot hold reSIDfp in real time may default to it.
 *
 * Measured on a Pixel 4 (docs/plans/sid-station/AUDIO-FIDELITY-TEST.md §6.3a):
 *   reSIDfp   495 ms of CPU per second of audio, 0 underruns
 *   SIDLite   158 ms of CPU per second of audio
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

  it("defaults the general edition to reSIDfp and the keypad edition to SIDLite", () => {
    const config = parseVariantSource(readFileSync(DEFAULT_VARIANTS_PATH, "utf8"));
    const editions = Object.values(config.variants) as {
      runtime: { defaultT9InputEnabled: boolean; defaultSidEmulationEngine: string };
    }[];
    const keypadEditions = editions.filter((edition) => edition.runtime.defaultT9InputEnabled);

    expect(config.variants[config.repo.defaultVariant].runtime.defaultSidEmulationEngine).toBe("residfp");
    expect(keypadEditions.length).toBeGreaterThan(0);
    for (const edition of keypadEditions) expect(edition.runtime.defaultSidEmulationEngine).toBe("sidlite");
    for (const edition of editions.filter((candidate) => !keypadEditions.includes(candidate))) {
      expect(edition.runtime.defaultSidEmulationEngine).toBe("residfp");
    }
  });

  it("builds the general edition with reSIDfp as its default", () => {
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
