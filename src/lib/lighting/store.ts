import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { BUNDLED_LIGHTING_PROFILES, DEFAULT_LIGHTING_AUTOMATION_STATE } from "@/lib/lighting/constants";
import type { LightingProfile, LightingStudioState } from "@/lib/lighting/types";

const STORAGE_KEY = "c64u_lighting_studio_state:v1";

const defaultLightingStudioState = (): LightingStudioState => ({
  activeProfileId: null,
  profiles: BUNDLED_LIGHTING_PROFILES,
  automation: DEFAULT_LIGHTING_AUTOMATION_STATE,
  lastResolvedLocation: null,
});

const mergeProfiles = (profiles: LightingProfile[]) => {
  const bundledById = new Map(BUNDLED_LIGHTING_PROFILES.map((profile) => [profile.id, profile]));
  const userProfiles = profiles.filter((profile) => !bundledById.has(profile.id));
  return [...BUNDLED_LIGHTING_PROFILES, ...userProfiles];
};

export const loadLightingStudioState = (): LightingStudioState => {
  if (typeof localStorage === "undefined") return defaultLightingStudioState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultLightingStudioState();
  try {
    const parsed = JSON.parse(raw) as Partial<LightingStudioState>;
    return {
      activeProfileId: parsed.activeProfileId ?? null,
      profiles: mergeProfiles(Array.isArray(parsed.profiles) ? parsed.profiles : []),
      automation: {
        ...DEFAULT_LIGHTING_AUTOMATION_STATE,
        ...parsed.automation,
        connectionSentinel: {
          ...DEFAULT_LIGHTING_AUTOMATION_STATE.connectionSentinel,
          ...parsed.automation?.connectionSentinel,
        },
        quietLaunch: {
          ...DEFAULT_LIGHTING_AUTOMATION_STATE.quietLaunch,
          ...parsed.automation?.quietLaunch,
        },
        sourceIdentityMap: {
          ...DEFAULT_LIGHTING_AUTOMATION_STATE.sourceIdentityMap,
          ...parsed.automation?.sourceIdentityMap,
        },
        circadian: {
          ...DEFAULT_LIGHTING_AUTOMATION_STATE.circadian,
          ...parsed.automation?.circadian,
          locationPreference: {
            ...DEFAULT_LIGHTING_AUTOMATION_STATE.circadian.locationPreference,
            ...parsed.automation?.circadian?.locationPreference,
          },
        },
      },
      lastResolvedLocation: parsed.lastResolvedLocation ?? null,
    };
  } catch (error) {
    addLog("warn", "Failed to load lighting studio state from storage", buildErrorLogDetails(error as Error));
    return defaultLightingStudioState();
  }
};

export const saveLightingStudioState = (state: LightingStudioState) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
