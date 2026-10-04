/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */
import { test, expect } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { enableKeypad } from "./focusRing";
import { constrainCallbackCpu } from "./callbackCpu";
import { disableTraceAssertions } from "./traceUtils";
import { saveCoverageFromPage } from "./withCoverage";

// Measured with callbackCpuKernel on the Pixel 4 under CDP rate 2; see the performance report.
const HALF_PIXEL_KERNEL_MS = 171.8;

for (const viewport of [
  { width: 320, height: 426 },
  { width: 800, height: 1280 },
]) {
  test.describe(`Contextful draw at ${viewport.width}px`, () => {
    let server: Awaited<ReturnType<typeof createMockC64Server>>;
    test.use({ viewport });
    test.beforeEach(async ({ page }, testInfo) => {
      disableTraceAssertions(testInfo, "Rendering and navigation contracts; no device writes.");
      const calibration = await constrainCallbackCpu(page, HALF_PIXEL_KERNEL_MS);
      await testInfo.attach("cpu-calibration", {
        body: JSON.stringify(calibration, (key, value) => (key === "session" ? undefined : value)),
        contentType: "application/json",
      });
      server = await createMockC64Server();
      await seedUiMocks(page, server.baseUrl);
      await page.addInitScript(() => {
        const raw = localStorage.getItem("c64u_saved_devices:v1");
        if (!raw) throw new Error("Missing saved-device fixture for overlay navigation");
        const saved = JSON.parse(raw);
        saved.devices.push({ ...saved.devices[0], id: "overlay-second-device", name: "Second device" });
        localStorage.setItem("c64u_saved_devices:v1", JSON.stringify(saved));
      });
      await enableKeypad(page);
    });
    test.afterEach(async ({ page }, testInfo) => {
      await saveCoverageFromPage(page, testInfo.title);
      await server?.close();
    });

    const warmSettings = async (page: import("@playwright/test").Page) => {
      await page.goto("/settings");
      const slot = page.locator('[data-slot-active="true"]');
      await expect(slot.locator('[data-section-scope="settings"][data-body-mounted="true"]')).toHaveCount(12);
      await page.keyboard.press("6");
      await expect(page).toHaveURL(/\/docs$/);
      await page.keyboard.press("5");
      await expect(page).toHaveURL(/\/settings$/);
      return page.locator('[data-slot-active="true"]');
    };

    test("keeps distant measured bodies deferred, paints visible bodies, and builds a jumped-to chapter @layout", async ({
      page,
    }) => {
      const slot = await warmSettings(page);
      const about = slot.locator('[data-section-id="about"]');
      await expect(about).toHaveAttribute("data-open", "true");
      await expect(about).not.toHaveAttribute("data-body-mounted", "true");
      const visible = await slot.locator('[data-open="true"]').evaluateAll((cards) =>
        cards
          .filter((card) => {
            const rect = card.getBoundingClientRect();
            return rect.top < innerHeight && rect.bottom > 0;
          })
          .every((card) => (card as HTMLElement).dataset.bodyMounted === "true"),
      );
      expect(visible).toBe(true);
      await about.scrollIntoViewIfNeeded();
      await expect(about).toHaveAttribute("data-body-mounted", "true");
      await expect(about.getByText("Version", { exact: true })).toBeVisible();
      await page.setViewportSize(viewport.width === 320 ? { width: 800, height: 1280 } : { width: 320, height: 426 });
      await expect(about.getByText("Version", { exact: true })).toBeVisible();
    });

    test("opening and closing global overlays preserves the deferred page and keypad traversal still completes it @layout", async ({
      page,
    }) => {
      const slot = await warmSettings(page);
      const about = slot.locator('[data-section-id="about"]');
      for (const [key, id] of [
        ["*", "diagnostics-sheet"],
        ["#", "switch-device-sheet"],
        ["ContextMenu", "keypad-quick-menu"],
      ]) {
        await page.keyboard.press(key);
        await expect(page.getByTestId(id)).toBeVisible();
        await page.keyboard.press("ArrowDown");
        await expect(about).not.toHaveAttribute("data-body-mounted", "true");
        await page.keyboard.press("Escape");
        await expect(page.getByTestId(id)).toBeHidden();
        await expect(about).not.toHaveAttribute("data-body-mounted", "true");
      }
      await page.keyboard.press("ArrowDown");
      await expect(about).toHaveAttribute("data-body-mounted", "true");
    });
  });
}
