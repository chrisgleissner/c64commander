/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

/**
 * Settings is a set of collapsible chapters rather than one scroll of every control the app
 * owns. The shared fixture seeds them all open, because every other spec is about the controls
 * inside them — so the collapsed default, which is what a first visit actually looks like, is
 * asserted here with that seed cleared.
 */

const CLOSED_BY_DEFAULT = [
  "appearance",
  "diagnostics",
  "play-and-disk",
  "device-safety",
  "notifications",
  "about",
] as const;

const clearSectionState = (page: Page) =>
  page.addInitScript(() => {
    try {
      localStorage.removeItem("c64u_settings_open_sections");
    } catch (error) {
      if (location.origin !== "null") throw error;
    }
  });

test.describe("Settings sections", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test("a first visit shows the chapters, not every control at once", async ({ page }) => {
    await clearSectionState(page);
    await page.goto("/settings");

    // Connection is what most Settings visits are about, so it is the one that opens.
    await expect(page.getByTestId("settings-section-connection")).toHaveAttribute("data-open", "true");
    for (const id of CLOSED_BY_DEFAULT) {
      await expect(page.getByTestId(`settings-section-${id}`)).toHaveAttribute("data-open", "false");
    }

    // Each closed chapter still says what it decides, so nothing has to be opened to find it.
    await expect(page.getByTestId("settings-section-appearance")).toContainText("Theme");
    await expect(page.getByTestId("settings-section-play-and-disk")).toContainText("Live View");
  });

  test("opening a chapter reveals exactly the controls it always held", async ({ page }) => {
    await clearSectionState(page);
    await page.goto("/settings");

    await expect(page.getByTestId("settings-show-autofire")).toHaveCount(0);
    await page.getByTestId("settings-section-toggle-play-and-disk").click();

    await expect(page.getByTestId("settings-show-autofire")).toBeVisible();
    await expect(page.getByTestId("settings-game-mode-controls")).toBeVisible();
    await expect(page.getByTestId("settings-game-mode-on-launch")).toBeVisible();
  });

  test("a chapter left open is still open on the next visit", async ({ page }) => {
    await clearSectionState(page);
    await page.goto("/settings");

    await page.getByTestId("settings-section-toggle-notifications").click();
    await expect(page.getByTestId("settings-section-notifications")).toHaveAttribute("data-open", "true");

    await page.goto("/");
    await page.goto("/settings");
    await expect(page.getByTestId("settings-section-notifications")).toHaveAttribute("data-open", "true");
  });

  // "OK goes in, Back comes out" — the chapters add one ring level, and every control has to
  // stay reachable through it with no pointer at all.
  test("the keypad reaches a control inside a chapter", async ({ page }) => {
    await clearSectionState(page);
    await page.addInitScript(() => {
      try {
        localStorage.setItem("c64u_feature_flag:keypad_input_enabled", "1");
      } catch (error) {
        if (location.origin !== "null") throw error;
      }
    });
    await page.goto("/settings");

    const header = page.getByTestId("settings-section-toggle-appearance");
    await expect(header).toBeVisible();

    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press("ArrowDown");
      const onSection = await page.evaluate(
        () => document.activeElement?.getAttribute("data-section-label") === "Appearance",
      );
      if (onSection) {
        await page.keyboard.press("Enter");
        reached = true;
      }
    }
    expect(reached, "the ring never reached the Appearance chapter").toBe(true);

    await expect(page.getByTestId("settings-section-appearance")).toHaveAttribute("data-open", "true");
  });
});
