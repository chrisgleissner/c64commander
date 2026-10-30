/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FEATURE_FLAG_DEFINITIONS } from "@/lib/config/featureFlagsRegistry.generated";
import { isSectionVisible, isSurfaceVisible, type SurfaceId } from "@/lib/appMode/surfaces";

const NEEDS_DEVICE: SurfaceId[] = [
  "route:/",
  "route:/disks",
  "route:/config",
  "home:live-view",
  "home:drives",
  "settings:connection",
  "settings:device-safety",
  "play:c64u-source",
  "play:engine-choice",
  "play:item-config",
  "quick-menu:machine-pause",
  "quick-menu:machine-reset",
  "quick-menu:game-mode",
  "quick-menu:switch-device",
  "quick-menu:stop-live-view",
];

const ALWAYS: SurfaceId[] = [
  "route:/play",
  "route:/settings",
  "route:/docs",
  "settings:appearance",
  "settings:hvsc",
  "settings:sid-radio",
  "play:hvsc",
  "flag:hvsc_enabled",
  "flag:commoserve_enabled",
];

describe("surface map", () => {
  it("SPM-ARCH-02 every needs-device surface is hidden in SID Player and shown in Full App", () => {
    for (const id of NEEDS_DEVICE) {
      expect(isSurfaceVisible(id, "sid-player"), id).toBe(false);
      expect(isSurfaceVisible(id, "full"), id).toBe(true);
    }
  });

  it("SPM-ARCH-02 always surfaces are shown in both modes", () => {
    for (const id of ALWAYS) {
      expect(isSurfaceVisible(id, "sid-player"), id).toBe(true);
      expect(isSurfaceVisible(id, "full"), id).toBe(true);
    }
  });

  it("SPM-ARCH-02 sid-player-only surfaces are hidden in Full App", () => {
    expect(isSurfaceVisible("quick-menu:leave-sid-player", "sid-player")).toBe(true);
    expect(isSurfaceVisible("quick-menu:leave-sid-player", "full")).toBe(false);
  });

  it("SPM-ARCH-02 a feature flag that requires a device is a needs-device surface without being listed", () => {
    for (const definition of FEATURE_FLAG_DEFINITIONS) {
      const id = `flag:${definition.id}` as SurfaceId;
      expect(isSurfaceVisible(id, "sid-player"), id).toBe(!definition.requires_device);
      expect(isSurfaceVisible(id, "full"), id).toBe(true);
    }
  });

  it("SPM-ARCH-02 sections of the Disks and Config pages follow their route", () => {
    expect(isSectionVisible("disks", "drive-a", "sid-player")).toBe(false);
    expect(isSectionVisible("config", "audio", "sid-player")).toBe(false);
    expect(isSectionVisible("disks", "drive-a", "full")).toBe(true);
  });

  it("SPM-ARCH-02 an unlisted section stays visible so that music is never hidden by omission", () => {
    expect(isSectionVisible("docs", "some-chapter", "sid-player")).toBe(true);
  });

  it("SPM-ED-01 surface visibility does not depend on the variant", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../../src/lib/appMode/surfaces.ts"), "utf8");
    expect(source).not.toMatch(/variant\.id|generated\/variant/);
  });
});
