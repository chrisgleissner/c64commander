/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect } from "vitest";
import { extractConfigValue } from "@/lib/config/configValueExtractor";

describe("extractConfigValue", () => {
  it("returns a plain string primitive as-is", () => {
    expect(extractConfigValue("NTSC")).toBe("NTSC");
  });

  it("returns a plain number primitive as-is", () => {
    expect(extractConfigValue(42)).toBe(42);
  });

  it("returns empty string for null", () => {
    expect(extractConfigValue(null)).toBe(null);
  });

  it("returns the array itself for an array input", () => {
    const arr = ["a", "b"];
    expect(extractConfigValue(arr)).toBe(arr);
  });

  it("extracts selected field (highest priority)", () => {
    expect(extractConfigValue({ selected: "PAL", value: "NTSC" })).toBe("PAL");
  });

  it("extracts value field when selected is absent", () => {
    expect(extractConfigValue({ value: "NTSC" })).toBe("NTSC");
  });

  it("extracts current field", () => {
    expect(extractConfigValue({ current: "auto" })).toBe("auto");
  });

  it("extracts current_value field", () => {
    expect(extractConfigValue({ current_value: "on" })).toBe("on");
  });

  it("extracts currentValue (camelCase) field", () => {
    expect(extractConfigValue({ currentValue: 100 })).toBe(100);
  });

  it("extracts default field", () => {
    expect(extractConfigValue({ default: "off" })).toBe("off");
  });

  it("extracts default_value field", () => {
    expect(extractConfigValue({ default_value: 0 })).toBe(0);
  });

  it("returns empty string when no known key is present", () => {
    expect(extractConfigValue({ unknown_key: "x" })).toBe("");
  });

  it("returns empty string for an empty object", () => {
    expect(extractConfigValue({})).toBe("");
  });

  it("selected with numeric value 0 is returned (not skipped as falsy)", () => {
    expect(extractConfigValue({ selected: 0 })).toBe(0);
  });

  it("selected with empty string returns empty string (not skipped)", () => {
    expect(extractConfigValue({ selected: "" })).toBe("");
  });
});
