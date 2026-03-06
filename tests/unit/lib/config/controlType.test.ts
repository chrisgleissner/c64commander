/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { getCheckboxMapping, inferControlKind } from "@/lib/config/controlType";

describe("getCheckboxMapping", () => {
  it("returns undefined when possibleValues is undefined", () => {
    expect(getCheckboxMapping(undefined)).toBeUndefined();
  });

  it("returns undefined when possibleValues is empty array", () => {
    expect(getCheckboxMapping([])).toBeUndefined();
  });

  it("returns checkbox mapping for Enabled/Disabled", () => {
    const result = getCheckboxMapping(["Enabled", "Disabled"]);
    expect(result).toEqual({
      checkedValue: "Enabled",
      uncheckedValue: "Disabled",
    });
  });

  it("returns checkbox mapping for On/Off", () => {
    const result = getCheckboxMapping(["On", "Off"]);
    expect(result).toEqual({ checkedValue: "On", uncheckedValue: "Off" });
  });

  it("returns checkbox mapping case-insensitively for enabled/disabled", () => {
    const result = getCheckboxMapping(["ENABLED", "DISABLED"]);
    expect(result).toEqual({
      checkedValue: "ENABLED",
      uncheckedValue: "DISABLED",
    });
  });

  it("returns checkbox mapping case-insensitively for on/off", () => {
    const result = getCheckboxMapping(["ON", "OFF"]);
    expect(result).toEqual({ checkedValue: "ON", uncheckedValue: "OFF" });
  });

  it("returns undefined for unrecognized 2-option pair", () => {
    expect(getCheckboxMapping(["Yes", "No"])).toBeUndefined();
  });

  it("returns undefined for 3+ distinct options", () => {
    expect(getCheckboxMapping(["Low", "Medium", "High"])).toBeUndefined();
  });

  it("handles whitespace padding around values", () => {
    const result = getCheckboxMapping([" On ", " Off "]);
    expect(result).toBeDefined();
    expect(result?.checkedValue).toBe(" On ");
    expect(result?.uncheckedValue).toBe(" Off ");
  });
});

describe("inferControlKind", () => {
  it('returns password for name containing "password"', () => {
    expect(inferControlKind({ name: "usb password", currentValue: "" })).toBe(
      "password",
    );
  });

  it("returns checkbox for Enabled/Disabled values", () => {
    expect(
      inferControlKind({
        name: "Feature",
        currentValue: "Enabled",
        possibleValues: ["Enabled", "Disabled"],
      }),
    ).toBe("checkbox");
  });

  it("returns checkbox for On/Off values", () => {
    expect(
      inferControlKind({
        name: "Feature",
        currentValue: "On",
        possibleValues: ["On", "Off"],
      }),
    ).toBe("checkbox");
  });

  it("returns slider for Off/Low/Medium/High values", () => {
    expect(
      inferControlKind({
        name: "Volume",
        currentValue: "Low",
        possibleValues: ["Off", "Low", "Medium", "High"],
      }),
    ).toBe("slider");
  });

  it("returns slider for audio mixer volume", () => {
    expect(
      inferControlKind({
        name: "Vol SID",
        category: "Audio Mixer",
        currentValue: "100",
        possibleValues: ["0", "50", "100"],
      }),
    ).toBe("slider");
  });

  it("returns slider for numeric option list", () => {
    expect(
      inferControlKind({
        name: "Frequency",
        currentValue: "985",
        possibleValues: ["985", "1050", "1250"],
      }),
    ).toBe("slider");
  });

  it("returns slider for left/center/right values", () => {
    expect(
      inferControlKind({
        name: "Position",
        currentValue: "Center",
        possibleValues: ["Left", "Center", "Right"],
      }),
    ).toBe("slider");
  });

  it("returns select for 2+ non-checkbox non-slider values", () => {
    expect(
      inferControlKind({
        name: "Mode",
        currentValue: "A",
        possibleValues: ["A", "B", "C"],
      }),
    ).toBe("select");
  });

  it("returns text when no possibleValues provided", () => {
    expect(
      inferControlKind({ name: "CustomValue", currentValue: "hello" }),
    ).toBe("text");
  });

  it("returns text when possibleValues is empty", () => {
    expect(
      inferControlKind({
        name: "CustomValue",
        currentValue: "hello",
        possibleValues: [],
      }),
    ).toBe("text");
  });

  it("returns text when possibleValues has only one option", () => {
    expect(
      inferControlKind({
        name: "CustomValue",
        currentValue: "hello",
        possibleValues: ["onlyone"],
      }),
    ).toBe("text");
  });

  it("returns select when possibleValues has exactly 2 unrecognized values", () => {
    expect(
      inferControlKind({
        name: "Mode",
        currentValue: "X",
        possibleValues: ["X", "Y"],
      }),
    ).toBe("select");
  });

  it("returns slider for too many numeric options at limit", () => {
    const values = Array.from({ length: 40 }, (_, i) => String(i));
    expect(
      inferControlKind({
        name: "Count",
        currentValue: "0",
        possibleValues: values,
      }),
    ).toBe("slider");
  });

  it("returns select for too many options (over slider limit)", () => {
    const values = Array.from({ length: 41 }, (_, i) => String(i));
    expect(
      inferControlKind({
        name: "Count",
        currentValue: "0",
        possibleValues: values,
      }),
    ).toBe("select");
  });

  it("returns select when some values have MHz but not all numeric (line 75 FALSE branch)", () => {
    // hasMhz=true for '1.2 MHz', but 'Turbo' fails numericWithUnitPattern
    expect(
      inferControlKind({
        name: "CPU Speed",
        currentValue: "1.2 MHz",
        possibleValues: ["1.2 MHz", "Turbo"],
      }),
    ).toBe("select");
  });

  it("returns slider for volume name containing volume keyword", () => {
    expect(
      inferControlKind({
        name: "System Volume",
        currentValue: "80",
        possibleValues: ["0", "50", "80", "100"],
      }),
    ).toBe("slider");
  });

  it("returns slider for isAudioMixerVolume without category prefix", () => {
    expect(
      inferControlKind({
        name: "Vol Main",
        currentValue: "50",
        possibleValues: ["0", "25", "50", "75", "100"],
      }),
    ).toBe("slider");
  });

  it("returns slider for MHz values list when all values are numeric (line 75 TRUE)", () => {
    // hasMhz=true AND isAllNumericLike is true → slider
    const values = ["1.0MHz", "1.5MHz", "2.0MHz"];
    expect(
      inferControlKind({
        name: "CPU Speed",
        currentValue: "1.0MHz",
        possibleValues: values,
      }),
    ).toBe("slider");
  });

  it("isOffLowMediumHigh: only matches when all four are present", () => {
    // Subset of Off/Low/Medium/High — should NOT return slider via that path
    // Instead falls through to other checks
    expect(
      inferControlKind({
        name: "Speed",
        currentValue: "Low",
        possibleValues: ["Off", "Low", "Medium"],
      }),
    ).toBe("select");
  });

  it("getCheckboxMapping returns undefined when only one distinct value", () => {
    // Neither Enabled/Disabled nor On/Off has length 2 distinct
    expect(getCheckboxMapping(["Same", "Same", "Same"])).toBeUndefined();
  });
});
