/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { firmwareOverridesItemConfig } from "@/lib/config/firmwareConfigLaunch";
import type { ConfigCandidate } from "@/lib/config/playbackConfig";

const candidate = (fileName: string, distance = 0): ConfigCandidate => ({
  ref: { kind: "ultimate", fileName, path: `/Usb0/Games/${fileName}`, modifiedAt: null, sizeBytes: null },
  strategy: distance === 0 ? "exact-name" : "parent-directory",
  distance,
  confidence: distance === 0 ? "high" : "low",
});

const item = (over: Partial<Parameters<typeof firmwareOverridesItemConfig>[0]> = {}) => ({
  category: "prg" as const,
  path: "/Usb0/Games/Game.prg",
  configRef: candidate("Game.cfg").ref,
  configOverrides: null,
  configCandidates: [candidate("Game.cfg")],
  ...over,
});

describe("deciding how a program has to reach the machine", () => {
  it("keeps the path launch when the app and the firmware would apply the same file", () => {
    expect(firmwareOverridesItemConfig(item())).toBe(false);
  });

  it("takes the upload launch when the user edited a value on top of that file", () => {
    expect(
      firmwareOverridesItemConfig(
        item({ configOverrides: [{ category: "U64 Specific Settings", item: "CPU Speed", value: "8" }] }),
      ),
    ).toBe(true);
  });

  it("takes the upload launch when the user declined the settings file", () => {
    expect(firmwareOverridesItemConfig(item({ configRef: null }))).toBe(true);
  });

  /*
   * A settings file that discovery found one directory up is not next to the program, so the
   * firmware never sees it. Only same-directory candidates decide this.
   */
  it("keeps the path launch when the only candidate is in a parent directory", () => {
    expect(
      firmwareOverridesItemConfig(
        item({ configRef: candidate("Shared.cfg", 1).ref, configCandidates: [candidate("Shared.cfg", 1)] }),
      ),
    ).toBe(false);
  });

  it("takes the upload launch when a sibling file exists and the user chose a different one", () => {
    expect(
      firmwareOverridesItemConfig(
        item({
          configRef: candidate("Shared.cfg", 1).ref,
          configCandidates: [candidate("Game.cfg"), candidate("Shared.cfg", 1)],
        }),
      ),
    ).toBe(true);
  });

  /*
   * A playlist item restored from storage carries its settings choice but not the discovery result
   * behind it, so the launch cannot tell what is beside the program. Reading that as "the firmware
   * will find one" is what makes a choice made before a restart survive the restart.
   */
  it("assumes the firmware finds a file when it does not know what is beside the program", () => {
    expect(firmwareOverridesItemConfig(item({ configRef: null, configCandidates: undefined }))).toBe(true);
  });

  it("keeps the path launch when the restored choice is the file the firmware would apply", () => {
    expect(firmwareOverridesItemConfig(item({ configCandidates: undefined }))).toBe(false);
  });

  it("keeps the path launch when a restored program has the .usr the firmware falls back to", () => {
    expect(
      firmwareOverridesItemConfig(item({ configRef: candidate("Game.usr").ref, configCandidates: undefined })),
    ).toBe(false);
  });

  it("keeps the path launch for a cartridge, which the firmware loads no settings for", () => {
    expect(
      firmwareOverridesItemConfig(
        item({
          category: "crt",
          path: "/Usb0/Games/Game.crt",
          configRef: null,
          configCandidates: [candidate("Game.cfg")],
        }),
      ),
    ).toBe(false);
  });
});
