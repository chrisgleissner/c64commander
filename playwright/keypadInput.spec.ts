/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

/**
 * CI-enforced proof of the keypad/keyboard (keypad_input_enabled) feature and its
 * PRIME DIRECTIVE: the only new affordance is the `data-key-selected` highlight,
 * shown ONLY once a recognized key takes effect and removed on touch. Not tagged
 * @screenshots/@web-platform so `npm run test:e2e` runs it.
 */

const KEYPAD_FLAG_KEY = "c64u_feature_flag:keypad_input_enabled";
const DEBUG_LOG_KEY = "c64u_debug_logging_enabled";
const SELECTED = "data-key-selected";

const snap = (page: Page, testInfo: TestInfo, label: string) => attachStepScreenshot(page, testInfo, label);

// The init script first runs against the very first `about:blank` document,
// whose opaque origin (`location.origin === "null"`) makes localStorage throw by
// design — that is expected and ignored. On a real origin any failure is genuine
// (e.g. storage denied) and is rethrown so a silently-unapplied flag cannot let
// a test pass against a broken toggle.
const setFlagInitScript = (page: Page, key: string) =>
  page.addInitScript(
    ({ flagKey, value }) => {
      try {
        localStorage.setItem(flagKey, value);
      } catch (error) {
        if (location.origin !== "null") throw error;
      }
    },
    { flagKey: key, value: "1" },
  );
const setFlagOffInitScript = (page: Page, key: string) =>
  page.addInitScript(
    ({ flagKey, value }) => {
      try {
        localStorage.setItem(flagKey, value);
      } catch (error) {
        if (location.origin !== "null") throw error;
      }
    },
    { flagKey: key, value: "0" },
  );
const enableKeypad = (page: Page) => setFlagInitScript(page, KEYPAD_FLAG_KEY);
const disableKeypad = (page: Page) => setFlagOffInitScript(page, KEYPAD_FLAG_KEY);
const enableDebugLogging = (page: Page) => setFlagInitScript(page, DEBUG_LOG_KEY);

const selectedCount = (page: Page) => page.locator(`[${SELECTED}="true"]`).count();

/** Steps the focus ring (ArrowDown) until `target` carries the highlight, bounded. */
const ringFocus = async (page: Page, target: Locator, maxSteps = 60): Promise<boolean> => {
  for (let step = 0; step < maxSteps; step += 1) {
    if ((await target.getAttribute(SELECTED)) === "true") return true;
    await page.keyboard.press("ArrowDown");
  }
  return (await target.getAttribute(SELECTED)) === "true";
};

// Runs only after `page.goto(...)`, so the page is on the real origin and
// localStorage is accessible. "No log key yet" is the one expected empty case and
// returns []. A JSON parse failure means the log serialization itself regressed,
// so it is left to throw and fail the test loudly rather than masked as "no
// entries".
const readKeyInputLogs = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("c64u_app_logs");
    if (!raw) return [] as Array<Record<string, unknown>>;
    return (JSON.parse(raw) as Array<{ message?: string }>).filter((entry) => entry?.message === "key-input");
  });

test.describe("Keypad / T9 input", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
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

  test("Prime Directive state 1: flag OFF → keys add no highlight or affordance", async ({ page }, testInfo) => {
    await disableKeypad(page);
    await page.goto("/");
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    expect(await selectedCount(page)).toBe(0);
    await snap(page, testInfo, "flag-off-no-highlight");
  });

  test("Prime Directive states 2→3→4: pre-key baseline, highlight on key, cleared on touch", async ({
    page,
  }, testInfo) => {
    await enableKeypad(page);
    await page.goto("/");
    await expect(page.getByTestId("tab-home")).toBeVisible();

    // State 2: flag on, before any recognized key → still no highlight.
    expect(await selectedCount(page)).toBe(0);
    await snap(page, testInfo, "state2-pre-key");

    // State 3: a recognized nav key → exactly one highlighted ring item.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(`[${SELECTED}="true"]`)).toHaveCount(1);
    await snap(page, testInfo, "state3-highlight");

    // State 4: a pointer interaction clears the highlight.
    await page.mouse.click(5, 5);
    await expect(page.locator(`[${SELECTED}="true"]`)).toHaveCount(0);
    await snap(page, testInfo, "state4-cleared");
  });

  test("State 3: a primary CTA (tab) is reachable by key and activates with Enter", async ({ page }, testInfo) => {
    await enableKeypad(page);
    await page.goto("/");
    await expect(page.getByTestId("tab-home")).toBeVisible();

    const reached = await ringFocus(page, page.getByTestId("tab-config"));
    expect(reached).toBe(true);
    await expect(page.getByTestId("tab-config")).toHaveAttribute(SELECTED, "true");
    await snap(page, testInfo, "cta-reached");

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/config/);
    await snap(page, testInfo, "cta-activated");
  });

  test("HAZARD 1: a focused slider — Left/Right change the value, Up/Down move focus", async ({ page }, testInfo) => {
    await enableKeypad(page);
    await page.goto("/");
    const slider = page.getByTestId("home-cpu-speed-slider");
    await expect(slider).toBeVisible();
    const thumb = slider.getByRole("slider");

    // Grouping is innermost-wins: the CPU & RAM card is itself a top-level ring
    // stop (the outer "Quick Config" wrapper is no longer a separate focus stop),
    // so OK descends straight from the card into its first control.
    const cpuCard = page.getByTestId("home-cpu-summary");
    expect(await ringFocus(page, cpuCard)).toBe(true);
    await expect(cpuCard).toHaveAttribute(SELECTED, "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("home-cpu-turbo-control")).toHaveAttribute(SELECTED, "true");
    await page.keyboard.press("ArrowDown");
    await expect(thumb).toHaveAttribute(SELECTED, "true");
    await snap(page, testInfo, "slider-focused");

    const before = await thumb.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => thumb.getAttribute("aria-valuenow")).not.toBe(before);
    // Focus did NOT move off the thumb on Left/Right.
    await expect.poll(() => thumb.evaluate((el) => document.activeElement === el)).toBe(true);
    await snap(page, testInfo, "slider-value-changed");

    const afterStep = await thumb.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowDown");
    // Up/Down move focus OFF the thumb and do NOT change the value.
    await expect.poll(() => thumb.evaluate((el) => document.activeElement === el)).toBe(false);
    expect(await thumb.getAttribute("aria-valuenow")).toBe(afterStep);
    await snap(page, testInfo, "slider-focus-moved");
  });

  test("HAZARD 2: a config dropdown opens by key and Radix owns option nav; Escape closes", async ({
    page,
  }, testInfo) => {
    await enableKeypad(page);
    // Boot on Home (clean init), then reach Config via client-side nav — a direct
    // deep goto("/config") can be served blank by the SW once earlier tests
    // registered it.
    await page.goto("/");
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await page.getByTestId("tab-config").click();
    await expect(page).toHaveURL(/\/config/);
    // The Video setup menu page exposes a select (System mode) for the dropdown HAZARD.
    await page.getByTestId("config-menu-page-video-setup").click();
    await snap(page, testInfo, "config-category-open");

    const trigger = page.locator('[data-testid^="config-select-trigger:"]').first();
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Reach the trigger via the keypad ring (so it is the current item), then
    // open it with Enter — no touch.
    const reached = await ringFocus(page, trigger, 90);
    expect(reached).toBe(true);
    await expect(trigger).toHaveAttribute(SELECTED, "true");
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await snap(page, testInfo, "dropdown-open");

    // While open, ArrowDown moves the OPTION highlight (Radix), not the page ring.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role="option"][data-highlighted]').first()).toBeVisible();
    // The underlying ring did not move: the trigger keeps its selection highlight.
    await expect(trigger).toHaveAttribute(SELECTED, "true");

    // Escape closes (Radix); the trigger collapses.
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await snap(page, testInfo, "dropdown-closed");

    // Keypad back (Android keyCode 4) also closes the dropdown via the layer.
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "keyCode", { get: () => 4 });
      window.dispatchEvent(event);
    });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await snap(page, testInfo, "dropdown-keypad-back-closed");
  });

  test("Literal typing: focused host field accepts hardware letters and digits directly", async ({
    page,
  }, testInfo) => {
    await enableKeypad(page);
    await page.goto("/settings");
    const host = page.getByTestId("settings-device-host");
    await expect(host).toBeVisible();
    await host.click();
    await host.fill("");
    await page.keyboard.type("u64-192");
    await expect(host).toHaveValue("u64-192");
    await snap(page, testInfo, "literal-host-entered");
  });

  test("Field focus: Enter edits the highlighted host row and Escape returns to the ring", async ({
    page,
  }, testInfo) => {
    await enableKeypad(page);
    await page.goto("/settings");
    const hostRow = page.getByTestId("settings-device-host-field");
    const host = page.getByTestId("settings-device-host");
    await expect(hostRow).toBeVisible();

    const reached = await ringFocus(page, hostRow, 90);
    expect(reached).toBe(true);
    await expect(hostRow).toHaveAttribute(SELECTED, "true");
    await expect.poll(() => host.evaluate((el) => document.activeElement === el)).toBe(false);
    await snap(page, testInfo, "host-row-highlighted");

    await page.keyboard.press("Enter");
    await expect.poll(() => host.evaluate((el) => document.activeElement === el)).toBe(true);
    await host.fill("");
    await page.keyboard.type("c64u42");
    await expect(host).toHaveValue("c64u42");

    await page.keyboard.press("Escape");
    await expect.poll(() => host.evaluate((el) => document.activeElement === el)).toBe(false);
    await expect(hostRow).toHaveAttribute(SELECTED, "true");
    await snap(page, testInfo, "host-row-after-escape");
  });

  test("Diagnostics: key-input logs gated by debug logging", async ({ page }) => {
    // Debug OFF → no key-input entries.
    await enableKeypad(page);
    await page.goto("/");
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("KeyQ");
    expect((await readKeyInputLogs(page)).length).toBe(0);
  });

  test("Diagnostics: debug ON → recognized and unmapped keys are logged", async ({ page }) => {
    await enableKeypad(page);
    await enableDebugLogging(page);
    await page.goto("/");
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("KeyQ");
    await expect.poll(async () => (await readKeyInputLogs(page)).length).toBeGreaterThan(0);
    const entries = (await readKeyInputLogs(page)) as Array<{ details?: Record<string, unknown> }>;
    const actions = entries.map((entry) => entry.details?.normalizedAction);
    expect(actions).toContain("dpadDown");
    expect(entries.some((entry) => entry.details?.normalizedAction === null)).toBe(true);
  });
});
