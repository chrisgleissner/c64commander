/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeSelectValue,
  resolveSelectValue,
  formatSelectOptionLabel,
  normalizeSelectOptions,
  normalizeOptionToken,
  parseNumericOption,
  resolveOptionIndex,
  resolveVolumeCenterIndex,
  resolvePanCenterIndex,
  clampSliderValue,
  clampToRange,
  resolveSliderIndex,
  applySoftDetent,
  formatSidBaseAddress,
  resolveSidSocketToggleValue,
  resolveSidAddressEnableValue,
  resolveSidAddressDisableValue,
  isSilentSidValue,
} from "@/pages/home/utils/uiLogic";

describe("normalizeSelectValue", () => {
  it("replaces empty string with sentinel", () => {
    expect(normalizeSelectValue("")).toBe("__empty__");
  });

  it("replaces whitespace-only with sentinel", () => {
    expect(normalizeSelectValue("   ")).toBe("__empty__");
  });

  it("passes through non-empty value", () => {
    expect(normalizeSelectValue("Foo")).toBe("Foo");
  });
});

describe("resolveSelectValue", () => {
  it("converts sentinel to empty string", () => {
    expect(resolveSelectValue("__empty__")).toBe("");
  });

  it("passes through normal value", () => {
    expect(resolveSelectValue("Bar")).toBe("Bar");
  });
});

describe("formatSelectOptionLabel", () => {
  it("maps sentinel to Default label", () => {
    expect(formatSelectOptionLabel("__empty__")).toBe("Default");
  });

  it("passes through normal label", () => {
    expect(formatSelectOptionLabel("Custom")).toBe("Custom");
  });
});

describe("normalizeSelectOptions", () => {
  it("deduplicates options", () => {
    const result = normalizeSelectOptions(["A", "B", "A"], "A");
    expect(result).toEqual(["A", "B"]);
  });

  it("appends currentValue when not in list", () => {
    const result = normalizeSelectOptions(["X", "Y"], "Z");
    expect(result).toContain("Z");
  });

  it("appends empty sentinel when options include empty string", () => {
    const result = normalizeSelectOptions(["A", ""], "A");
    expect(result).toContain("__empty__");
  });

  it("appends empty sentinel when currentValue is empty", () => {
    const result = normalizeSelectOptions(["A"], "");
    expect(result).toContain("__empty__");
  });

  it("omits empty sentinel when no empty values present", () => {
    const result = normalizeSelectOptions(["A", "B"], "A");
    expect(result).not.toContain("__empty__");
  });

  it("converts numeric options to strings", () => {
    const result = normalizeSelectOptions([42 as unknown as string], "42");
    expect(result).toContain("42");
  });

  it("filters out whitespace-only options after stringification", () => {
    const result = normalizeSelectOptions(["A", "  "], "A");
    expect(result).toContain("__empty__");
  });
});

describe("normalizeOptionToken", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeOptionToken("  Hello   World  ")).toBe("hello world");
  });
});

describe("parseNumericOption", () => {
  it("extracts integer", () => {
    expect(parseNumericOption("Volume 10")).toBe(10);
  });

  it("extracts negative number", () => {
    expect(parseNumericOption("-3 dB")).toBe(-3);
  });

  it("extracts float", () => {
    expect(parseNumericOption("Gain 1.5 dB")).toBe(1.5);
  });

  it("returns null for non-numeric string", () => {
    expect(parseNumericOption("Center")).toBeNull();
  });
});

describe("resolveOptionIndex", () => {
  const options = ["-6 dB", "0 dB", "+6 dB"];

  it("finds exact normalized match", () => {
    expect(resolveOptionIndex(options, "0 dB")).toBe(1);
  });

  it("finds numeric match when exact fails", () => {
    expect(resolveOptionIndex(options, "6")).toBe(2);
  });

  it("returns 0 when no match", () => {
    expect(resolveOptionIndex(options, "N/A")).toBe(0);
  });
});

describe("resolveVolumeCenterIndex", () => {
  it("finds numeric 0", () => {
    expect(resolveVolumeCenterIndex(["-6", "0", "+6"])).toBe(1);
  });

  it("finds 0 db token", () => {
    expect(resolveVolumeCenterIndex(["Low", "0 dB", "High"])).toBe(1);
  });

  it("returns null when no center", () => {
    expect(resolveVolumeCenterIndex(["Low", "High"])).toBeNull();
  });
});

describe("resolvePanCenterIndex", () => {
  it("finds center option", () => {
    expect(resolvePanCenterIndex(["Left", "Center", "Right"])).toBe(1);
  });

  it("returns null when no center", () => {
    expect(resolvePanCenterIndex(["Left", "Right"])).toBeNull();
  });
});

describe("clampSliderValue", () => {
  it("clamps below zero", () => {
    expect(clampSliderValue(-1, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clampSliderValue(15, 10)).toBe(10);
  });

  it("passes through in-range value", () => {
    expect(clampSliderValue(5, 10)).toBe(5);
  });
});

describe("clampToRange", () => {
  it("clamps below min", () => {
    expect(clampToRange(-5, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clampToRange(20, 0, 10)).toBe(10);
  });
});

describe("resolveSliderIndex", () => {
  it("rounds and clamps", () => {
    expect(resolveSliderIndex(2.7, 5)).toBe(3);
    expect(resolveSliderIndex(-1, 5)).toBe(0);
  });
});

describe("applySoftDetent", () => {
  it("returns value when centerIndex is null", () => {
    expect(applySoftDetent(3, null)).toBe(3);
  });

  it("snaps to center within detent range", () => {
    expect(applySoftDetent(5.1, 5)).toBe(5);
  });

  it("passes through outside detent range", () => {
    expect(applySoftDetent(6, 5)).toBe(6);
  });
});

describe("formatSidBaseAddress", () => {
  it("formats valid SID address", () => {
    expect(formatSidBaseAddress("$D420")).toBe("$D420");
  });

  it("returns $---- for null parse", () => {
    expect(formatSidBaseAddress("Unmapped")).toBe("$----");
  });

  it("returns $---- for garbage input", () => {
    expect(formatSidBaseAddress("XXXX")).toBe("$----");
  });
});

describe("resolveSidSocketToggleValue", () => {
  it("finds enabled token", () => {
    expect(resolveSidSocketToggleValue(["Off", "On"], true)).toBe("On");
  });

  it("finds disabled token", () => {
    expect(resolveSidSocketToggleValue(["Off", "On"], false)).toBe("Off");
  });

  it("falls back to first option for enable without match", () => {
    expect(resolveSidSocketToggleValue(["Alpha", "Beta"], true)).toBe("Alpha");
  });

  it("falls back to last option for disable without match", () => {
    expect(resolveSidSocketToggleValue(["Alpha", "Beta"], false)).toBe("Beta");
  });

  it("returns hardcoded Enabled for empty options", () => {
    expect(resolveSidSocketToggleValue([], true)).toBe("Enabled");
  });

  it("returns hardcoded Disabled for empty options", () => {
    expect(resolveSidSocketToggleValue([], false)).toBe("Disabled");
  });
});

describe("resolveSidAddressEnableValue", () => {
  it("picks first valid SID address option", () => {
    expect(resolveSidAddressEnableValue(["Unmapped", "$D420"])).toBe("$D420");
  });

  it("falls back to first option when no SID address", () => {
    expect(resolveSidAddressEnableValue(["None", "Other"])).toBe("None");
  });

  it("returns Unmapped when options empty", () => {
    expect(resolveSidAddressEnableValue([])).toBe("Unmapped");
  });
});

describe("resolveSidAddressDisableValue", () => {
  it("finds unmapped option", () => {
    expect(resolveSidAddressDisableValue(["$D420", "Unmapped"])).toBe("Unmapped");
  });

  it("finds disabled option", () => {
    expect(resolveSidAddressDisableValue(["$D420", "Disabled"])).toBe("Disabled");
  });

  it("finds off option", () => {
    expect(resolveSidAddressDisableValue(["$D420", "Off"])).toBe("Off");
  });

  it("returns Unmapped when no match", () => {
    expect(resolveSidAddressDisableValue(["$D420", "$D500"])).toBe("Unmapped");
  });
});

describe("isSilentSidValue", () => {
  it("detects silent value matching mute option", () => {
    expect(isSilentSidValue("OFF", ["ON", "OFF"])).toBe(true);
  });

  it("rejects non-mute value", () => {
    expect(isSilentSidValue("ON", ["ON", "OFF"])).toBe(false);
  });
});
