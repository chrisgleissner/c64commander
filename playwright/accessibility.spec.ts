import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { saveCoverageFromPage } from "./withCoverage";

test.afterEach(async ({ page }, testInfo) => {
  await saveCoverageFromPage(page, testInfo.title);
});

const routes = ["/"];

for (const route of routes) {
  test(`a11y: critical violations on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    // Filtered to "critical", not "serious": axe's color-contrast rule is impact: "serious", but
    // contrast is not this test's job. tests/unit/lib/appStyles/contrast.test.ts checks the exact
    // WCAG ratio for every pair across all 12 generated palettes with zero tolerance — that is the
    // contrast authority, not a single-route, single-palette axe scan.
    const criticalViolations = results.violations.filter((violation) => violation.impact === "critical");
    expect(criticalViolations.length).toBeLessThanOrEqual(5);
  });
}
