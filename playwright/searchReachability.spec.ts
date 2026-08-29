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
import { disableTraceAssertions } from "./traceUtils";
import { STATIC_SEARCH_ENTRIES } from "../src/generated/searchIndex";
import { FEATURE_FLAG_IDS } from "../src/lib/config/featureFlagsRegistry.generated";

/**
 * The half of the reachability walk (spec.md section 5.13) that needs a live page: `section` and
 * `control`. The other three kinds are proven in tests/unit/lib/search/reachability.test.ts, which
 * needs no render.
 *
 * One page load per path rather than one per entry: `requestSectionsBulk(true)` opens every card on
 * the page at once, so every section header and every control inside one is on screen together.
 * That keeps this to a handful of page loads instead of forty.
 */

type Anchored = { id: string; path: string; scope: string; sectionId: string; testId: string | null };

const ANCHORED: Anchored[] = STATIC_SEARCH_ENTRIES.flatMap((entry) => {
  if (entry.target.kind === "section") {
    return [
      { id: entry.id, path: entry.target.path, scope: entry.target.scope, sectionId: entry.target.id, testId: null },
    ];
  }
  if (entry.target.kind === "control") {
    return [
      {
        id: entry.id,
        path: entry.target.path,
        scope: entry.target.scope,
        sectionId: entry.target.sectionId,
        testId: entry.target.testId,
      },
    ];
  }
  return [];
});

const PATHS = [...new Set(ANCHORED.map((entry) => entry.path))];

const openEverySection = async (page: Page) => {
  // The same event the Quick menu's "Expand all sections" raises.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("c64u-collapsible-sections-bulk", { detail: { open: true } })),
  );
  await page.waitForTimeout(600);
};

test.describe("search index reachability", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "A structural walk of the index; no user journey is traced.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    // Section 5.13: an entry whose requirements are unmet is walked against a fixture that meets
    // them where one can. Every feature flag on is that fixture for the `flag` requirement, so a
    // row behind a flag that is off by default is still proven reachable.
    await page.addInitScript((ids: readonly string[]) => {
      for (const id of ids) localStorage.setItem(`c64u_feature_flag:${id}`, "1");
    }, FEATURE_FLAG_IDS);
    // A roomy viewport: nothing here is about layout, and a short one makes every card scroll.
    await page.setViewportSize({ width: 500, height: 1400 });
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const path of PATHS) {
    const entries = ANCHORED.filter((entry) => entry.path === path);
    test(`every anchored entry on ${path} reaches its anchor`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForFunction(() => document.readyState === "complete");
      await openEverySection(page);

      const missing: string[] = [];
      for (const entry of entries) {
        const section = page.locator(`[data-section-scope="${entry.scope}"][data-section-id="${entry.sectionId}"]`);
        if ((await section.count()) === 0) {
          missing.push(`${entry.id}: no section ${entry.scope}/${entry.sectionId} on ${path}`);
          continue;
        }
        if (entry.testId === null) continue;

        const control = page.locator(`[data-testid="${entry.testId}"]`).first();
        if ((await control.count()) === 0) {
          missing.push(`${entry.id}: section ${entry.sectionId} rendered but ${entry.testId} did not`);
          continue;
        }
        /*
         * Operable, which is the rule navigateToSearchTarget's focusAnchor actually applies: the
         * anchor takes focus itself, or it holds a control that does. A group container — the text
         * size row, the theme row — is the second case, and landing on it puts the next key press
         * on the first button inside it.
         */
        const operable = await control.evaluate((element) => {
          const selector = "a[href], button, input, select, textarea, [tabindex]";
          return element.matches(selector) || element.querySelector(selector) !== null;
        });
        if (!operable) missing.push(`${entry.id}: ${entry.testId} is on screen but holds nothing operable`);
      }

      expect(missing, `unreachable search index entries on ${path}`).toEqual([]);
    });
  }
});
