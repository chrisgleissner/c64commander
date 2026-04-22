import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_IDS } from "@/lib/config/featureFlagsRegistry.generated";

declare global {
  var __setFeatureFlagTestState:
    | ((state?: { developerMode?: boolean; overrides?: Record<string, boolean> }) => void)
    | undefined;
}

describe("test setup feature flag isolation", () => {
  it("initializes every registered feature flag in storage", () => {
    FEATURE_FLAG_IDS.forEach((id) => {
      expect(localStorage.getItem(`c64u_feature_flag:${id}`)).toBe("1");
      expect(sessionStorage.getItem(`c64u_feature_flag:${id}`)).toBe("1");
    });
  });

  it("clears previously stored prefixed keys that are not in the static registry list", () => {
    localStorage.setItem("c64u_feature_flag:future_flag", "1");
    sessionStorage.setItem("c64u_feature_flag:future_flag", "0");

    globalThis.__setFeatureFlagTestState?.();

    expect(localStorage.getItem("c64u_feature_flag:future_flag")).toBeNull();
    expect(sessionStorage.getItem("c64u_feature_flag:future_flag")).toBeNull();
  });

  it("rejects disabled shared feature-flag overrides so tests stay deterministic", () => {
    expect(() => globalThis.__setFeatureFlagTestState?.({ overrides: { hvsc_enabled: false } })).toThrow(
      /must keep all feature flags enabled/,
    );
  });
});
