import { describe, expect, it } from "vitest";

import { shouldShowHvscControls } from "@/pages/playFiles/hvscControlsVisibility";

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
});
