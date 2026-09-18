/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * The rules here are the firmware's, not the app's, so they are written against what the firmware
 * was measured doing rather than against what reads well. On a C64 Ultimate running firmware 1.2RC:
 * setting "Filename overflow squeeze" to "End" over REST and then calling `runners:run_prg` on a
 * program with a sibling `.cfg` holding "Middle" left the item at "Middle". Deleting the `.cfg` and
 * leaving a `.usr` with the same contents gave the same result. Doing the same around
 * `runners:run_crt` left the item at "End", so the firmware loads nothing there.
 */

import { describe, expect, it } from "vitest";
import {
  firmwareAppliesAssociatedConfig,
  firmwareAssociatedConfigFor,
  firmwareAssociatedConfigNames,
  firmwareOverridesAppConfig,
  replaceFileExtension,
} from "@/lib/config/firmwareAssociatedConfig";

describe("what the firmware itself loads beside a launched file", () => {
  it("replaces the extension the way the firmware's set_extension does", () => {
    expect(replaceFileExtension("Game.prg", "cfg")).toBe("Game.cfg");
    expect(replaceFileExtension("My.Great.Game.prg", "cfg")).toBe("My.Great.Game.cfg");
    expect(replaceFileExtension("README", "cfg")).toBe("README.cfg");
  });

  it("loads a settings file for a program and for nothing else the app can launch", () => {
    expect(firmwareAppliesAssociatedConfig("prg")).toBe(true);
    expect(firmwareAppliesAssociatedConfig("crt")).toBe(false);
    expect(firmwareAppliesAssociatedConfig("disk")).toBe(false);
    expect(firmwareAppliesAssociatedConfig("sid")).toBe(false);
    expect(firmwareAppliesAssociatedConfig(null)).toBe(false);
  });

  it("tries the .cfg first and the .usr second, and only for a program", () => {
    expect(firmwareAssociatedConfigNames("Game.prg", "prg")).toEqual(["Game.cfg", "Game.usr"]);
    expect(firmwareAssociatedConfigNames("Game.crt", "crt")).toEqual([]);
  });

  it("picks the .cfg when both files are there", () => {
    expect(
      firmwareAssociatedConfigFor({
        fileName: "Game.prg",
        category: "prg",
        siblingFileNames: ["Game.usr", "Game.prg", "Game.cfg"],
      }),
    ).toBe("Game.cfg");
  });

  it("falls back to the .usr when no .cfg is there", () => {
    expect(
      firmwareAssociatedConfigFor({
        fileName: "Game.prg",
        category: "prg",
        siblingFileNames: ["GAME.USR", "Game.prg"],
      }),
    ).toBe("Game.usr");
  });

  it("loads nothing beside a cartridge, whatever sits next to it", () => {
    expect(
      firmwareAssociatedConfigFor({
        fileName: "Game.crt",
        category: "crt",
        siblingFileNames: ["Game.cfg", "Game.usr"],
      }),
    ).toBeNull();
  });
});

describe("when the firmware would undo the app's settings choice", () => {
  const base = { fileName: "Game.prg", category: "prg" as const, siblingFileNames: ["Game.prg", "Game.cfg"] };

  it("leaves the launch alone when the app is applying the same file the firmware would", () => {
    expect(firmwareOverridesAppConfig({ ...base, appConfigFileName: "Game.cfg", hasOverrides: false })).toBe(false);
  });

  it("reports a conflict when the user edited values on top of that file", () => {
    expect(firmwareOverridesAppConfig({ ...base, appConfigFileName: "Game.cfg", hasOverrides: true })).toBe(true);
  });

  it("reports a conflict when the user asked for no settings file at all", () => {
    expect(firmwareOverridesAppConfig({ ...base, appConfigFileName: null, hasOverrides: false })).toBe(true);
  });

  it("reports a conflict when the user chose a different settings file", () => {
    expect(firmwareOverridesAppConfig({ ...base, appConfigFileName: "Shared.cfg", hasOverrides: false })).toBe(true);
  });

  it("leaves the launch alone when there is no settings file for the firmware to load", () => {
    expect(
      firmwareOverridesAppConfig({
        fileName: "Game.prg",
        category: "prg",
        siblingFileNames: ["Game.prg"],
        appConfigFileName: "Shared.cfg",
        hasOverrides: true,
      }),
    ).toBe(false);
  });

  it("leaves a cartridge launch alone, because the firmware loads nothing there", () => {
    expect(
      firmwareOverridesAppConfig({
        fileName: "Game.crt",
        category: "crt",
        siblingFileNames: ["Game.crt", "Game.cfg"],
        appConfigFileName: null,
        hasOverrides: true,
      }),
    ).toBe(false);
  });
});
