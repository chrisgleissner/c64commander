import { describe, expect, it } from "vitest";
import { DEFAULT_LIGHTING_AUTOMATION_STATE } from "@/lib/lighting/constants";
import { buildLightingContextSignals, type LightingContextSignalInput } from "@/lib/lighting/contextLensSignals";
import type { LightingProfile, LightingStudioState } from "@/lib/lighting/types";

const profile = { id: "calm", name: "Calm", surfaces: {} } as unknown as LightingProfile;

const buildStudioState = (): LightingStudioState => ({
  activeProfileId: "calm",
  profiles: [profile],
  automation: {
    ...DEFAULT_LIGHTING_AUTOMATION_STATE,
    connectionSentinel: { enabled: true, mappings: { connected: "calm" } },
    sourceIdentityMap: { ...DEFAULT_LIGHTING_AUTOMATION_STATE.sourceIdentityMap, enabled: true },
    circadian: { ...DEFAULT_LIGHTING_AUTOMATION_STATE.circadian, enabled: true },
  },
  lastResolvedLocation: null,
});

const buildInput = (overrides: Partial<LightingContextSignalInput> = {}): LightingContextSignalInput => ({
  studioState: buildStudioState(),
  activeProfile: profile,
  connectionState: "connected",
  circadian: {
    period: "night",
    nextBoundaryLabel: "06:00",
    resolvedLocation: { source: "city", lat: 1, lon: 2, label: "London" },
  },
  playbackContext: { sourceBucket: "hvsc", activeItemLabel: null },
  manualLockEnabled: false,
  previewActive: false,
  ...overrides,
});

const valueOf = (input: LightingContextSignalInput, id: string) =>
  buildLightingContextSignals(input).find((signal) => signal.id === id)?.value;

describe("buildLightingContextSignals", () => {
  it("reports every contributing signal with its current value", () => {
    const input = buildInput();
    expect(buildLightingContextSignals(input).map((signal) => signal.id)).toEqual([
      "profile",
      "connection",
      "source",
      "circadian",
      "quiet-launch",
      "manual-lock",
      "preview",
    ]);
    expect(valueOf(input, "profile")).toBe("Calm");
    expect(valueOf(input, "connection")).toBe("Connected, shows Calm");
    expect(valueOf(input, "source")).toBe("HVSC");
    expect(valueOf(input, "circadian")).toBe("Night in London, next 06:00");
  });

  it("marks rules that are switched off and surfaces held state", () => {
    const studioState = buildStudioState();
    studioState.automation.sourceIdentityMap.enabled = false;
    studioState.automation.circadian.enabled = false;
    const input = buildInput({
      studioState,
      activeProfile: null,
      connectionState: null,
      circadian: null,
      playbackContext: { sourceBucket: null, activeItemLabel: null },
      manualLockEnabled: true,
      previewActive: true,
    });
    expect(valueOf(input, "profile")).toBe("Device look");
    expect(valueOf(input, "connection")).toBe("Unknown");
    expect(valueOf(input, "source")).toBe("None, rule off");
    expect(valueOf(input, "circadian")).toBe("Rule off");
    expect(valueOf(input, "manual-lock")).toBe("Held");
    expect(valueOf(input, "preview")).toBe("Active");
  });
});
