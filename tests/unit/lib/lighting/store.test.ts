import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLightingStudioState, saveLightingStudioState } from "@/lib/lighting/store";

describe("lighting studio storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns bundled defaults when storage is empty", () => {
    const state = loadLightingStudioState();
    expect(state.profiles.length).toBeGreaterThan(0);
    expect(state.automation.circadian.locationPreference.city).toBe("London");
  });

  it("merges bundled profiles with stored user profiles", () => {
    localStorage.setItem(
      "c64u_lighting_studio_state:v1",
      JSON.stringify({
        activeProfileId: "user-profile",
        profiles: [
          {
            id: "user-profile",
            name: "User Profile",
            savedAt: "2026-03-19T00:00:00.000Z",
            surfaces: {
              case: { mode: "Fixed Color", intensity: 10 },
            },
          },
        ],
        automation: {
          circadian: {
            enabled: true,
            locationPreference: {
              city: "Tokyo",
            },
          },
        },
      }),
    );

    const state = loadLightingStudioState();
    expect(state.activeProfileId).toBe("user-profile");
    expect(state.profiles.some((profile) => profile.id === "user-profile")).toBe(true);
    expect(state.profiles.some((profile) => profile.bundled)).toBe(true);
    expect(state.automation.circadian.enabled).toBe(true);
    expect(state.automation.circadian.locationPreference.city).toBe("Tokyo");
  });

  it("falls back to defaults and logs a warning when storage is corrupt", () => {
    localStorage.setItem("c64u_lighting_studio_state:v1", "{bad json");
    const state = loadLightingStudioState();
    expect(state.activeProfileId).toBeNull();
    expect(state.profiles.some((profile) => profile.bundled)).toBe(true);
  });

  it("persists the studio state back to localStorage", () => {
    const state = loadLightingStudioState();
    saveLightingStudioState(state);
    expect(localStorage.getItem("c64u_lighting_studio_state:v1")).toContain('"profiles"');
  });
});
