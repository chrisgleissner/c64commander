import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_IDS } from "@/lib/config/featureFlagsRegistry.generated";

const FEATURE_FLAG_STORAGE_PREFIX = "c64u_feature_flag:";

declare global {
  var __setFeatureFlagTestState:
    | ((state?: { developerMode?: boolean; overrides?: Record<string, boolean> }) => void)
    | undefined;
}

describe("test setup feature flag isolation", () => {
  it("initializes every registered feature flag in storage", () => {
    FEATURE_FLAG_IDS.forEach((id) => {
      expect(localStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}${id}`)).toBe("1");
      expect(sessionStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}${id}`)).toBe("1");
    });
  });

  it("clears previously stored prefixed keys that are not in the static registry list", () => {
    localStorage.setItem(`${FEATURE_FLAG_STORAGE_PREFIX}future_flag`, "1");
    sessionStorage.setItem(`${FEATURE_FLAG_STORAGE_PREFIX}future_flag`, "0");

    expect(globalThis.__setFeatureFlagTestState).toBeTypeOf("function");
    const setFeatureFlagTestState = globalThis.__setFeatureFlagTestState!;

    setFeatureFlagTestState();

    expect(localStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}future_flag`)).toBeNull();
    expect(sessionStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}future_flag`)).toBeNull();
  });

  it("rejects disabled shared feature-flag overrides so tests stay deterministic", () => {
    expect(globalThis.__setFeatureFlagTestState).toBeTypeOf("function");
    const setFeatureFlagTestState = globalThis.__setFeatureFlagTestState!;

    expect(() => setFeatureFlagTestState({ overrides: { hvsc_enabled: false } })).toThrow(
      /must keep all feature flags enabled/,
    );
  });
});
