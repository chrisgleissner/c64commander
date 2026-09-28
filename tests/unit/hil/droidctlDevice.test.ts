/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which phone the HIL harnesses drive, now that they go through droidctl rather than a bare adb.
 *
 * The rule is the one `./build` applies: an explicit serial, else the only physical device, else the
 * only Pixel with the `9B0` serial prefix, and never a guess between several.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error -- a HIL harness is plain JavaScript with no type declarations.
import { chooseTarget } from "../../../tools/hil/droidctl_device.mjs";
// @ts-expect-error -- a HIL harness is plain JavaScript with no type declarations.
import { MAIN_ROUTES } from "../../../tools/hil/release_sweep_hil.mjs";

const target = (serial: string, extra: Record<string, unknown> = {}) => ({
  targetId: `adb:${serial}`,
  serial,
  state: "device",
  isEmulator: false,
  ...extra,
});

describe("chooseTarget", () => {
  it("takes the serial it was given", () => {
    expect(chooseTarget([target("9B0A"), target("XYZ")], "XYZ").targetId).toBe("adb:XYZ");
  });

  it("refuses a serial that is not attached", () => {
    expect(() => chooseTarget([target("9B0A")], "XYZ")).toThrow(/XYZ is not attached/);
  });

  it("takes the only physical device when an emulator is attached beside it", () => {
    expect(chooseTarget([target("emulator-5554", { isEmulator: true }), target("ABC")]).serial).toBe("ABC");
  });

  it("prefers the one Pixel among several phones", () => {
    expect(chooseTarget([target("ABC"), target("9B081FFAZ001WX")]).serial).toBe("9B081FFAZ001WX");
  });

  it("refuses to guess between two phones that are not a single Pixel", () => {
    expect(() => chooseTarget([target("ABC"), target("DEF")])).toThrow(/several devices attached/);
  });

  it("ignores a device that is offline or unauthorized", () => {
    expect(chooseTarget([target("9B0A", { state: "unauthorized" }), target("ABC")]).serial).toBe("ABC");
  });

  it("says so when nothing is attached", () => {
    expect(() => chooseTarget([])).toThrow(/no Android device attached/);
  });
});

describe("the release sweep's error census", () => {
  it("visits Docs as well as the other five main routes", () => {
    expect(MAIN_ROUTES).toEqual(["/", "/play", "/disks", "/config", "/settings", "/docs"]);
  });
});
