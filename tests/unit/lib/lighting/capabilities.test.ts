import { describe, expect, it } from "vitest";
import {
  buildLightingUpdatePayload,
  formatLightingColor,
  normalizeLightingCapability,
  normalizeLightingState,
  normalizeSurfaceStateForCapability,
} from "@/lib/lighting/capabilities";

const modernConfig = {
  items: {
    "LedStrip Mode": { selected: "Fixed Color", options: ["Off", "Fixed Color"] },
    "LedStrip Pattern": { selected: "SingleColor", options: ["SingleColor", "Outward"] },
    "Fixed Color": { selected: "Royal Blue", options: ["Red", "Royal Blue"] },
    "Strip Intensity": { selected: 15, min: 0, max: 31 },
    "LedStrip SID Select": { selected: "SID 1", options: ["SID 1", "SID 2"] },
    "Color tint": { selected: "Pure", options: ["Pure", "Warm"] },
  },
};

const legacyRgbConfig = {
  items: {
    "LedStrip Mode": { selected: "Fixed Color", options: ["Off", "Fixed Color"] },
    "Strip Intensity": { selected: 8, min: 0, max: 15 },
    "Fixed Color Red": { selected: 12 },
    "Fixed Color Green": { selected: 34 },
    "Fixed Color Blue": { selected: 56 },
  },
};

const directValuesConfig = {
  "LedStrip Mode": { selected: "Fixed Color", values: ["Off", "Fixed Color"] },
  "LedStrip Pattern": { selected: "SingleColor", values: ["SingleColor", "Outward"] },
  "Fixed Color": { selected: "Red", values: ["Red", "Green"] },
  "Strip Intensity": { selected: 9 },
  "Color tint": { selected: "Warm" },
  "LedStrip SID Select": { selected: "SID 2" },
};

describe("lighting capabilities", () => {
  it("normalizes a modern named-color capability set", () => {
    const capability = normalizeLightingCapability("case", modernConfig);
    expect(capability.supported).toBe(true);
    expect(capability.colorEncoding).toBe("named");
    expect(capability.supportsTint).toBe(true);
    expect(capability.supportsSidSelect).toBe(true);
  });

  it("normalizes a legacy rgb capability set", () => {
    const capability = normalizeLightingCapability("case", legacyRgbConfig);
    expect(capability.colorEncoding).toBe("rgb");
    expect(capability.supportsTint).toBe(false);
    expect(capability.intensityRange.max).toBe(15);
  });

  it("marks empty capability payloads as unsupported", () => {
    const capability = normalizeLightingCapability("keyboard", undefined);
    expect(capability.supported).toBe(false);
    expect(capability.colorEncoding).toBeNull();
    expect(capability.supportedModes).toEqual([]);
  });

  it("accepts direct config objects and values-based option lists", () => {
    const capability = normalizeLightingCapability("keyboard", directValuesConfig);
    expect(capability.supported).toBe(true);
    expect(capability.supportedModes).toEqual(["Off", "Fixed Color"]);
    expect(capability.supportedPatterns).toEqual(["SingleColor", "Outward"]);
    expect(capability.intensityRange).toEqual({ min: 0, max: 31 });
    expect(capability.supportsTint).toBe(true);
    expect(capability.supportsSidSelect).toBe(true);
  });

  it("normalizes runtime state from named-color config", () => {
    const capability = normalizeLightingCapability("case", modernConfig);
    const state = normalizeLightingState(capability, modernConfig);
    expect(state).toMatchObject({
      mode: "Fixed Color",
      pattern: "SingleColor",
      intensity: 15,
      tint: "Pure",
      sidSelect: "SID 1",
      color: { kind: "named", value: "Royal Blue" },
    });
  });

  it("normalizes runtime state from rgb config and unsupported configs", () => {
    const rgbCapability = normalizeLightingCapability("case", legacyRgbConfig);
    expect(normalizeLightingState(rgbCapability, legacyRgbConfig)).toMatchObject({
      mode: "Fixed Color",
      intensity: 8,
      color: { kind: "rgb", r: 12, g: 34, b: 56 },
    });

    const unsupported = normalizeLightingCapability("keyboard", undefined);
    expect(normalizeLightingState(unsupported, undefined)).toBeNull();
  });

  it("omits color when named-color configs do not currently expose one", () => {
    const config = {
      items: {
        "LedStrip Mode": { selected: "Fixed Color", options: ["Off", "Fixed Color"] },
        "Fixed Color": { selected: "", options: ["Red"] },
        "Strip Intensity": { selected: 6, min: 0, max: 31 },
      },
    };
    const capability = normalizeLightingCapability("case", config);
    expect(normalizeLightingState(capability, config)).toMatchObject({
      mode: "Fixed Color",
      intensity: 6,
      color: undefined,
    });
  });

  it("falls back missing runtime values to empty strings and zeroes for sparse rgb configs", () => {
    const sparseRgbConfig = {
      items: {
        "LedStrip Mode": { selected: "", options: ["Off", "Fixed Color"] },
        "LedStrip Pattern": { selected: "", options: ["SingleColor"] },
        "Strip Intensity": { selected: 0, min: 0, max: 31 },
        "Fixed Color Red": {},
        "Fixed Color Green": {},
        "Fixed Color Blue": {},
        "Color tint": { selected: "" },
        "LedStrip SID Select": { selected: "" },
      },
    };
    const capability = normalizeLightingCapability("case", sparseRgbConfig);
    expect(normalizeLightingState(capability, sparseRgbConfig)).toMatchObject({
      mode: "",
      pattern: "",
      tint: "",
      sidSelect: "",
      intensity: 0,
      color: { kind: "rgb", r: 0, g: 0, b: 0 },
    });
  });

  it("maps named colors into rgb when applying to legacy devices", () => {
    const capability = normalizeLightingCapability("case", legacyRgbConfig);
    const normalized = normalizeSurfaceStateForCapability(capability, {
      mode: "Fixed Color",
      intensity: 99,
      color: { kind: "named", value: "Red" },
    });
    expect(normalized).toMatchObject({
      mode: "Fixed Color",
      intensity: 15,
      color: { kind: "rgb", r: 255, g: 0, b: 0 },
    });
  });

  it("drops unsupported fields during capability normalization", () => {
    const capability = normalizeLightingCapability("case", legacyRgbConfig);
    const normalized = normalizeSurfaceStateForCapability(capability, {
      mode: "Fixed Color",
      tint: "Warm",
      sidSelect: "SID 2",
      color: { kind: "rgb", r: 1, g: 2, b: 3 },
    });
    expect(normalized?.tint).toBeUndefined();
    expect(normalized?.sidSelect).toBeUndefined();
    expect(normalized?.color).toMatchObject({ kind: "rgb", r: 1, g: 2, b: 3 });
  });

  it("keeps tint and SID select when the capability exposes those items without option lists", () => {
    const capability = normalizeLightingCapability("case", directValuesConfig);
    const normalized = normalizeSurfaceStateForCapability(capability, {
      tint: "Warm",
      sidSelect: "SID 2",
    });
    expect(normalized).toEqual({
      tint: "Warm",
      sidSelect: "SID 2",
    });
  });

  it("maps rgb colors back to the closest allowed named color and drops unsupported named colors", () => {
    const capability = normalizeLightingCapability("case", modernConfig);
    const fromRgb = normalizeSurfaceStateForCapability(capability, {
      color: { kind: "rgb", r: 250, g: 10, b: 10 },
      intensity: 12,
    });
    expect(fromRgb?.color).toEqual({ kind: "named", value: "Red" });

    const invalidNamed = normalizeSurfaceStateForCapability(capability, {
      mode: "Pulse",
      pattern: "Unknown",
      tint: "Pastel",
      sidSelect: "SID 9",
      color: { kind: "named", value: "Green" },
    });
    expect(invalidNamed).toEqual({});
  });

  it("drops rgb-to-named and named-to-rgb conversions when no palette match exists", () => {
    const namedCapability = normalizeLightingCapability("case", {
      items: {
        "LedStrip Mode": { selected: "Fixed Color", options: ["Fixed Color"] },
        "Fixed Color": { selected: "Mystery", options: ["Mystery"] },
        "Strip Intensity": { selected: 5, min: 0, max: 31 },
      },
    });
    expect(
      normalizeSurfaceStateForCapability(namedCapability, {
        color: { kind: "rgb", r: 1, g: 2, b: 3 },
      }),
    ).toEqual({});

    const rgbCapability = normalizeLightingCapability("case", legacyRgbConfig);
    expect(
      normalizeSurfaceStateForCapability(rgbCapability, {
        color: { kind: "named", value: "Mystery" },
      }),
    ).toEqual({});
  });

  it("builds update payloads for named-color devices", () => {
    const capability = normalizeLightingCapability("case", modernConfig);
    const payload = buildLightingUpdatePayload(capability, {
      mode: "Fixed Color",
      pattern: "SingleColor",
      intensity: 12,
      tint: "Warm",
      sidSelect: "SID 2",
      color: { kind: "named", value: "Red" },
    });
    expect(payload).toEqual({
      "LedStrip Mode": "Fixed Color",
      "LedStrip Pattern": "SingleColor",
      "Strip Intensity": 12,
      "Color tint": "Warm",
      "LedStrip SID Select": "SID 2",
      "Fixed Color": "Red",
    });
  });

  it("builds rgb payloads and formats unset or rgb colors for display", () => {
    const rgbCapability = normalizeLightingCapability("case", legacyRgbConfig);
    expect(
      buildLightingUpdatePayload(rgbCapability, {
        intensity: 6,
        color: { kind: "rgb", r: 1, g: 2, b: 3 },
      }),
    ).toEqual({
      "Strip Intensity": 6,
      "Fixed Color Red": 1,
      "Fixed Color Green": 2,
      "Fixed Color Blue": 3,
    });

    expect(buildLightingUpdatePayload(normalizeLightingCapability("keyboard", undefined), { intensity: 5 })).toEqual(
      {},
    );
    expect(formatLightingColor(undefined)).toBe("Unset");
    expect(formatLightingColor({ kind: "rgb", r: 1, g: 2, b: 3 })).toBe("rgb(1, 2, 3)");
  });

  it("formats named colors and compares missing lighting states deterministically", async () => {
    const { lightingStateEquals } = await import("@/lib/lighting/capabilities");
    expect(formatLightingColor({ kind: "named", value: "Green" })).toBe("Green");
    expect(lightingStateEquals(null, undefined)).toBe(true);
    expect(lightingStateEquals({ mode: "Off" }, { mode: "Fixed Color" })).toBe(false);
  });
});
