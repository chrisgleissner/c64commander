/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SID_EMULATION_ENGINE, loadSidEmulationEngine, saveSidEmulationEngine } from "@/lib/config/appSettings";
import { variant } from "@/generated/variant";

/**
 * Every variant prefers libSidplayEZ ("Fast & accurate"), which renders what reSIDfp renders at
 * about a third of the CPU. Where it does not exist the playback layer falls back to reSIDfp; the
 * cheap SIDLite is never a default, because it audibly is not a C64.
 */
describe("SID emulation engine setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("follows the active build variant's default", () => {
    expect(DEFAULT_SID_EMULATION_ENGINE).toBe(variant.runtime.defaultSidEmulationEngine);
  });

  it("prefers libSidplayEZ on every shipped variant", () => {
    expect(variant.runtime.defaultSidEmulationEngine).toBe("sidplayez");
    expect(DEFAULT_SID_EMULATION_ENGINE).toBe("sidplayez");
  });

  it("uses the default when nothing is stored", () => {
    expect(loadSidEmulationEngine()).toBe(DEFAULT_SID_EMULATION_ENGINE);
  });

  it("round-trips every explicit choice", () => {
    for (const engine of ["sidlite", "residfp", "sidplayez"] as const) {
      saveSidEmulationEngine(engine);
      expect(loadSidEmulationEngine()).toBe(engine);
    }
  });

  it("falls back to the default rather than trusting an unknown stored value", () => {
    localStorage.setItem("c64u_sid_renderer", "reSID-turbo-9000");
    expect(loadSidEmulationEngine()).toBe(DEFAULT_SID_EMULATION_ENGINE);
  });

  it("carries a stored Light choice from the old setting over as Light", () => {
    localStorage.setItem("c64u_sid_emulation_engine", "sidlite");
    expect(loadSidEmulationEngine()).toBe("sidlite");
  });

  it("carries a stored Accurate choice from the old setting over as the default, not as one library", () => {
    // The old two-way setting stored "residfp" to mean accurate. It now names one specific renderer,
    // so the old value is read by meaning: the accurate default, which is libSidplayEZ where it exists.
    localStorage.setItem("c64u_sid_emulation_engine", "residfp");
    expect(loadSidEmulationEngine()).toBe(DEFAULT_SID_EMULATION_ENGINE);
  });

  it("lets a choice made under the new setting win over the old one", () => {
    localStorage.setItem("c64u_sid_emulation_engine", "sidlite");
    saveSidEmulationEngine("residfp");
    expect(loadSidEmulationEngine()).toBe("residfp");
  });
});
