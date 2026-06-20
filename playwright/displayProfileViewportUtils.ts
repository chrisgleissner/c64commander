import { expect, type Page } from "@playwright/test";

import { DISPLAY_PROFILE_VIEWPORTS, type DisplayProfileViewportId } from "./displayProfileViewports";

export const applyDisplayProfileViewport = async (page: Page, profileId: DisplayProfileViewportId) => {
  const profile = DISPLAY_PROFILE_VIEWPORTS[profileId];
  await page.setViewportSize(profile.viewport);
  await page.evaluate((override) => {
    localStorage.setItem("c64u_display_profile_override", override);
    window.dispatchEvent(
      new CustomEvent("c64u-ui-preferences-changed", {
        detail: { displayProfileOverride: override },
      }),
    );
  }, profile.override);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.displayProfile))
    .toBe(profile.expectedProfile);
};
