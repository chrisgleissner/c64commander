import { describe, expect, it } from "vitest";
import { DEFAULT_LIGHTING_AUTOMATION_STATE } from "@/lib/lighting/constants";
import { normalizeLightingCapability } from "@/lib/lighting/capabilities";
import { resolveLightingState } from "@/lib/lighting/resolver";
import type { LightingStudioState } from "@/lib/lighting/types";

const modernConfig = {
  items: {
    "LedStrip Mode": { selected: "Fixed Color", options: ["Off", "Fixed Color"] },
    "LedStrip Pattern": { selected: "SingleColor", options: ["SingleColor"] },
    "Fixed Color": { selected: "Royal Blue", options: ["Red", "Green", "Royal Blue"] },
    "Strip Intensity": { selected: 15, min: 0, max: 31 },
    "LedStrip SID Select": { selected: "SID 1", options: ["SID 1", "SID 2"] },
    "Color tint": { selected: "Pure", options: ["Pure", "Warm", "Pastel", "Whisper", "Bright"] },
  },
};

const capabilities = {
  case: normalizeLightingCapability("case", modernConfig),
  keyboard: normalizeLightingCapability("keyboard", modernConfig),
};

const studioState: LightingStudioState = {
  activeProfileId: "base",
  profiles: [
    {
      id: "base",
      name: "Base",
      savedAt: new Date(0).toISOString(),
      surfaces: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 10, tint: "Pure" },
        keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 10, tint: "Pure" },
      },
    },
    {
      id: "critical",
      name: "Critical",
      savedAt: new Date(0).toISOString(),
      surfaces: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Red" }, intensity: 25, tint: "Warm" },
        keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Red" }, intensity: 25, tint: "Warm" },
      },
    },
    {
      id: "source",
      name: "HVSC",
      savedAt: new Date(0).toISOString(),
      surfaces: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Royal Blue" }, intensity: 20, tint: "Pastel" },
      },
    },
  ],
  automation: {
    ...DEFAULT_LIGHTING_AUTOMATION_STATE,
    connectionSentinel: {
      enabled: true,
      mappings: { error: "critical" },
    },
    quietLaunch: {
      enabled: true,
      profileId: "critical",
      windowMs: 30_000,
    },
    sourceIdentityMap: {
      enabled: true,
      mappings: { hvsc: "source", idle: null },
    },
    circadian: {
      enabled: true,
      locationPreference: {
        useDeviceLocation: false,
        manualCoordinates: null,
        city: "London",
      },
    },
  },
  lastResolvedLocation: null,
};

describe("lighting resolver", () => {
  it("uses the active profile as the base layer", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {},
      studioState,
      previewState: null,
      manualLockState: null,
      manualLockEnabled: false,
      connectionState: null,
      quietLaunchActive: false,
      sourceBucket: null,
      circadian: null,
    });
    expect(resolved.activeProfile?.name).toBe("Base");
    expect(resolved.resolvedState.case?.color).toEqual({ kind: "named", value: "Green" });
  });

  it("applies circadian modifiers above the base profile", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {},
      studioState,
      previewState: null,
      manualLockState: null,
      manualLockEnabled: false,
      connectionState: null,
      quietLaunchActive: false,
      sourceBucket: null,
      circadian: {
        period: "night",
        nextBoundaryLabel: "06:00",
        fallbackActive: false,
        resolvedLocation: { source: "city", lat: 1, lon: 2, label: "London" },
      },
    });
    expect(resolved.resolvedState.case?.tint).toBe("Whisper");
    expect(resolved.circadianChip).toBe("Circadian: Night");
  });

  it("applies source identity mapping above circadian modifiers", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {},
      studioState,
      previewState: null,
      manualLockState: null,
      manualLockEnabled: false,
      connectionState: null,
      quietLaunchActive: false,
      sourceBucket: "hvsc",
      circadian: {
        period: "evening",
        nextBoundaryLabel: "22:00",
        fallbackActive: false,
        resolvedLocation: { source: "city", lat: 1, lon: 2, label: "London" },
      },
    });
    expect(resolved.resolvedState.case?.color).toEqual({ kind: "named", value: "Royal Blue" });
    expect(resolved.sourceCue?.bucket).toBe("hvsc");
  });

  it("suppresses the source cue when a higher-priority owner wins", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {},
      studioState,
      previewState: null,
      manualLockState: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 4, tint: "Pure" },
      },
      manualLockEnabled: true,
      connectionState: null,
      quietLaunchActive: false,
      sourceBucket: "hvsc",
      circadian: null,
    });
    expect(resolved.contextLens.find((entry) => entry.surface === "case")?.owner).toBe("manual-lock");
    expect(resolved.sourceCue).toBeNull();
  });

  it("applies quiet launch above source rules and manual lock above non-critical automation", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {},
      studioState,
      previewState: null,
      manualLockState: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 3, tint: "Pure" },
      },
      manualLockEnabled: true,
      connectionState: null,
      quietLaunchActive: true,
      sourceBucket: "hvsc",
      circadian: null,
    });
    expect(resolved.resolvedState.case?.intensity).toBe(3);
    expect(resolved.contextLens.find((entry) => entry.surface === "case")?.owner).toBe("manual-lock");
  });

  it("applies critical connection overrides above manual lock and quiet launch", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {},
      studioState,
      previewState: null,
      manualLockState: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 2, tint: "Pure" },
      },
      manualLockEnabled: true,
      connectionState: "error",
      quietLaunchActive: true,
      sourceBucket: "hvsc",
      circadian: null,
    });
    expect(resolved.resolvedState.case?.color).toEqual({ kind: "named", value: "Red" });
    expect(resolved.activeAutomationChip).toBe("Auto: Error");
  });

  it("applies preview overrides above every other layer", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {},
      studioState,
      previewState: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Royal Blue" }, intensity: 30, tint: "Bright" },
      },
      manualLockState: null,
      manualLockEnabled: false,
      connectionState: "error",
      quietLaunchActive: true,
      sourceBucket: "hvsc",
      circadian: null,
    });
    expect(resolved.resolvedState.case?.intensity).toBe(30);
    expect(resolved.contextLens.find((entry) => entry.surface === "case")?.owner).toBe("preview");
  });

  it("uses raw device fallback, ambient connection mapping, and visible source cues when unsuppressed", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 9, tint: "Pure" },
        keyboard: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 8, tint: "Pure" },
      },
      studioState: {
        ...studioState,
        activeProfileId: null,
        automation: {
          ...studioState.automation,
          connectionSentinel: {
            enabled: true,
            mappings: { connected: "critical" },
          },
        },
      },
      previewState: null,
      manualLockState: null,
      manualLockEnabled: false,
      connectionState: "connected",
      quietLaunchActive: false,
      sourceBucket: "hvsc",
      circadian: null,
    });

    expect(resolved.contextLens.find((entry) => entry.surface === "case")?.owner).toBe("source-identity");
    expect(resolved.activeAutomationChip).toBe("Source: HVSC");
    expect(resolved.sourceCue).toEqual({ bucket: "hvsc", label: "HVSC look" });
  });

  it("omits circadian chips when circadian automation is disabled and leaves source cues hidden without mappings", () => {
    const resolved = resolveLightingState({
      capabilities,
      rawDeviceState: {
        case: { mode: "Fixed Color", color: { kind: "named", value: "Green" }, intensity: 9, tint: "Pure" },
      },
      studioState: {
        ...studioState,
        automation: {
          ...studioState.automation,
          circadian: {
            ...studioState.automation.circadian,
            enabled: false,
          },
          sourceIdentityMap: {
            enabled: true,
            mappings: { hvsc: null },
          },
        },
      },
      previewState: null,
      manualLockState: null,
      manualLockEnabled: false,
      connectionState: null,
      quietLaunchActive: false,
      sourceBucket: "hvsc",
      circadian: {
        period: "day",
        nextBoundaryLabel: "20:00",
        fallbackActive: false,
        resolvedLocation: { source: "city", lat: 1, lon: 2, label: "London" },
      },
    });

    expect(resolved.circadianChip).toBeNull();
    expect(resolved.sourceCue).toBeNull();
    expect(resolved.contextLens.find((entry) => entry.surface === "case")?.owner).toBe("profile");
  });
});
