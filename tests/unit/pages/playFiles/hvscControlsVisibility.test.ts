import { describe, expect, it } from "vitest";

import {
  shouldCancelHvscLifecycleOnDisable,
  shouldIncludeHvscSource,
  shouldOpenHvscPreparation,
  shouldShowHvscControls,
} from "@/pages/playFiles/hvscControlsVisibility";

describe("shouldShowHvscControls", () => {
  it("shows HVSC controls while feature flags are still loading when the default flag is enabled", () => {
    expect(
      shouldShowHvscControls({
        flags: { hvsc_enabled: true },
        isLoaded: false,
      }),
    ).toBe(true);
  });

  it("hides HVSC controls when the HVSC flag is disabled", () => {
    expect(
      shouldShowHvscControls({
        flags: { hvsc_enabled: false },
        isLoaded: true,
      }),
    ).toBe(false);
  });

  it("includes the HVSC source only when the feature is enabled and the runtime bridge is available", () => {
    expect(
      shouldIncludeHvscSource(
        {
          flags: { hvsc_enabled: true },
          isLoaded: true,
        },
        true,
      ),
    ).toBe(true);
    expect(
      shouldIncludeHvscSource(
        {
          flags: { hvsc_enabled: false },
          isLoaded: true,
        },
        true,
      ),
    ).toBe(false);
    expect(
      shouldIncludeHvscSource(
        {
          flags: { hvsc_enabled: true },
          isLoaded: true,
        },
        false,
      ),
    ).toBe(false);
  });

  it("opens HVSC preparation only for enabled HVSC sources that are not ready yet", () => {
    expect(
      shouldOpenHvscPreparation(
        {
          flags: { hvsc_enabled: true },
          isLoaded: true,
        },
        "hvsc",
        "DOWNLOADING",
      ),
    ).toBe(true);
    expect(
      shouldOpenHvscPreparation(
        {
          flags: { hvsc_enabled: true },
          isLoaded: true,
        },
        "hvsc",
        "READY",
      ),
    ).toBe(false);
    expect(
      shouldOpenHvscPreparation(
        {
          flags: { hvsc_enabled: false },
          isLoaded: true,
        },
        "hvsc",
        "DOWNLOADING",
      ),
    ).toBe(false);
  });

  it("cancels active HVSC preparation when the feature is disabled", () => {
    expect(shouldCancelHvscLifecycleOnDisable(false, "DOWNLOADING")).toBe(true);
    expect(shouldCancelHvscLifecycleOnDisable(false, "INGESTING")).toBe(true);
    expect(shouldCancelHvscLifecycleOnDisable(false, "READY")).toBe(false);
    expect(shouldCancelHvscLifecycleOnDisable(true, "DOWNLOADING")).toBe(false);
  });
});
