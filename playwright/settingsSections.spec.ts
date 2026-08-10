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

/**
 * Show the page as a FIRST visit sees it, with no chapter state stored at all.
 *
 * The fixture's "all open" seed is itself an init script, so clearing the key from the loaded
 * page and reloading would just restore it. This registers a second init script instead, which
 * runs after the seed on every navigation and removes what the seed just wrote. It must be
 * called before the first `goto`.
 *
 * Settings' open/closed memory lives in the shared collapsibleSectionStore key
 * ("c64u_open_sections"), scoped per page ("settings:<id>"), alongside entries for other pages
 * (e.g. Docs) that this helper must leave untouched - so it strips only the "settings:" entries
 * out of the array rather than deleting the whole key.
 */
const startAtFirstVisit = async (page: Page) => {
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem("c64u_open_sections");
      const ids: unknown = raw ? JSON.parse(raw) : [];
      const kept = Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string" && !id.startsWith("settings:"))
        : [];
      localStorage.setItem("c64u_open_sections", JSON.stringify(kept));
    } catch (error) {
      if (location.origin !== "null") throw error;
    }
  });
  await page.goto("/settings");
  await expect(page.getByTestId("settings-section-appearance")).toBeVisible();
};

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
    await startAtFirstVisit(page);

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
    await startAtFirstVisit(page);

    await expect(page.getByTestId("settings-show-autofire")).toHaveCount(0);
    await page.getByTestId("settings-section-toggle-play-and-disk").click();

    await expect(page.getByTestId("settings-show-autofire")).toBeVisible();
    await expect(page.getByTestId("settings-game-mode-joystick")).toBeVisible();
    await expect(page.getByTestId("settings-game-mode-on-launch")).toBeVisible();
  });

  // Tested by closing rather than opening: the fixture seeds every chapter open, so closing one
  // is the change that has to survive, and no init script has to be worked around to see it.
  test("a chapter closed on one visit is still closed on the next", async ({ page }) => {
    await page.goto("/settings");
    const notifications = page.getByTestId("settings-section-notifications");
    await expect(notifications).toHaveAttribute("data-open", "true");

    await page.getByTestId("settings-section-toggle-notifications").click();
    await expect(notifications).toHaveAttribute("data-open", "false");

    await page.goto("/");
    await page.goto("/settings");
    await expect(page.getByTestId("settings-section-notifications")).toHaveAttribute("data-open", "false");
    // The chapters the user did not touch are untouched.
    await expect(page.getByTestId("settings-section-connection")).toHaveAttribute("data-open", "true");
  });

  // "OK goes in, Back comes out" — the chapters add one ring level, and every control has to
  // stay reachable through it with no pointer at all.
  test("the keypad reaches a chapter and opens it with no pointer at all", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("c64u_feature_flag:keypad_input_enabled", "1");
      } catch (error) {
        if (location.origin !== "null") throw error;
      }
    });
    await startAtFirstVisit(page);

    const appearance = page.getByTestId("settings-section-appearance");
    await expect(appearance).toHaveAttribute("data-open", "false");

    // The ring marks where it is with `data-key-selected` rather than by moving DOM focus, and
    // it lands either on the chapter container or on the header button inside it. Both count as
    // having reached the chapter.
    const selectionIsInsideAppearance = () =>
      page.evaluate(() =>
        Boolean(
          document.querySelector('[data-key-selected="true"]')?.closest("[data-testid='settings-section-appearance']"),
        ),
      );

    let reached = false;
    for (let step = 0; step < 60 && !reached; step += 1) {
      await page.keyboard.press("ArrowDown");
      reached = await selectionIsInsideAppearance();
    }
    expect(reached, "the ring never reached the Appearance chapter").toBe(true);

    // "OK goes in": from the chapter container OK descends to the header, and from the header
    // OK opens the chapter, so this takes at most two presses.
    for (let press = 0; press < 2; press += 1) {
      if ((await appearance.getAttribute("data-open")) === "true") break;
      await page.keyboard.press("Enter");
    }
    await expect(appearance).toHaveAttribute("data-open", "true");
  });
});
