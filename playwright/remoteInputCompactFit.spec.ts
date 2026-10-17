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
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { installLiveViewStreamStub } from "./liveViewStreamStub";

const { width: WIDTH, height: HEIGHT } = DISPLAY_PROFILE_VIEWPORTS.compact.viewport;
const NAVIGATION_BAR_PX = 48;
const WATCH_ON_BOTTOM_INSET_PX = 0;
const MIN_TARGET_PX = 44;
const MIN_TEXT_PX = 14;

type Box = { x: number; y: number; width: number; height: number };

const boxOf = async (page: Page, testId: string): Promise<Box> => {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  return box as Box;
};

const expectInsideViewport = (name: string, box: Box, navigationBarPx = NAVIGATION_BAR_PX) => {
  expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y, `${name} top edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(WIDTH + 0.5);
  expect(box.y + box.height, `${name} bottom edge`).toBeLessThanOrEqual(HEIGHT - navigationBarPx + 0.5);
};

test.describe("Remote Input sheet on the compact display profile", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout geometry only; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    const bottomInsetPx = testInfo.titlePath.includes("with Watch on") ? WATCH_ON_BOTTOM_INSET_PX : NAVIGATION_BAR_PX;
    await page.addInitScript((bottom) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = `:root { --safe-area-inset-top: 30px !important; --safe-area-inset-bottom: ${bottom}px !important; }`;
        document.head.append(style);
      });
    }, bottomInsetPx);
    await installLiveViewStreamStub(page);
    await page.goto("/");
    await page.getByTestId("home-machine-inline-openRemoteInput").first().click();
    await expect(page.getByTestId("remote-input-sheet")).toBeVisible();
    await page.waitForTimeout(700);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("joystick mode shows the whole stick, FIRE and a one-row toolbar without scrolling", async ({
    page,
  }, testInfo) => {
    await testInfo.attach("compact-joystick", { body: await page.screenshot(), contentType: "image/png" });
    const toolbarIds = [
      "remote-input-mode-joystick",
      "remote-input-mode-type",
      "remote-input-joystick-options",
      "remote-input-immersive-toggle",
      "remote-input-panic-button",
    ];
    const rowTops = new Set<number>();
    for (const id of toolbarIds) {
      const box = await boxOf(page, id);
      expectInsideViewport(id, box);
      expect(box.width, `${id} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      expect(box.height, `${id} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      rowTops.add(Math.round(box.y / 4));
    }
    expect(rowTops.size, "the toolbar is a single row").toBe(1);

    for (const id of [
      "remote-input-stick-zone",
      "remote-input-stick-thumb",
      "remote-input-fire-button",
      "remote-input-port-1",
      "remote-input-port-2",
    ]) {
      expectInsideViewport(id, await boxOf(page, id));
    }
    const body = page.locator('[data-testid="remote-input-sheet"] [data-surface-body="true"]');
    expect(await body.evaluate((el) => el.scrollTop), "the body has not scrolled").toBe(0);
  });

  test("port is a labelled 1 | 2 choice", async ({ page }) => {
    const port1 = page.getByTestId("remote-input-port-1");
    const port2 = page.getByTestId("remote-input-port-2");
    await expect(port2).toHaveAttribute("aria-pressed", "true");
    await port1.click();
    await expect(port1).toHaveAttribute("aria-pressed", "true");
    await expect(port2).toHaveAttribute("aria-pressed", "false");
  });

  test("keys mode scrolls every key row into the space between the toolbar and the footer", async ({
    page,
  }, testInfo) => {
    await page.getByTestId("remote-input-mode-type").click();
    await page.waitForTimeout(500);
    await testInfo.attach("compact-keys", { body: await page.screenshot(), contentType: "image/png" });

    const scroller = page.getByTestId("remote-input-keyboard-scroll");
    const keys = page.getByTestId("remote-input-type-keyboard").locator("button");
    const count = await keys.count();
    expect(count).toBeGreaterThan(40);

    for (let index = 0; index < count; index += 1) {
      const key = keys.nth(index);
      await key.scrollIntoViewIfNeeded();
      const keyBox = (await key.boundingBox()) as Box;
      const scrollBox = (await scroller.boundingBox()) as Box;
      const name = (await key.getAttribute("data-testid")) ?? `key ${index}`;
      expect(keyBox.y, `${name} top within the key scroller`).toBeGreaterThanOrEqual(scrollBox.y - 1.5);
      expect(keyBox.y + keyBox.height, `${name} bottom within the key scroller`).toBeLessThanOrEqual(
        scrollBox.y + scrollBox.height + 1.5,
      );
      expect(keyBox.x, `${name} left edge`).toBeGreaterThanOrEqual(-0.5);
      expect(keyBox.x + keyBox.width, `${name} right edge`).toBeLessThanOrEqual(WIDTH + 0.5);
    }

    const footer = await boxOf(page, "remote-input-mirror-controls").catch(() => null);
    if (footer) {
      const scrollBox = (await scroller.boundingBox()) as Box;
      expect(scrollBox.y + scrollBox.height, "the key scroller ends above the footer").toBeLessThanOrEqual(
        footer.y + 0.5,
      );
    }

    const faces = await page
      .getByTestId("remote-input-type-keyboard")
      .locator("button")
      .evaluateAll((els) =>
        els.map((el) => ({
          id: el.getAttribute("data-testid") ?? "",
          px: Math.min(
            ...Array.from(el.querySelectorAll("span"))
              .filter(
                (span) => (span.textContent ?? "").trim().length > 0 && span.getAttribute("aria-hidden") !== "true",
              )
              .map((span) => parseFloat(getComputedStyle(span).fontSize)),
          ),
        })),
      );
    for (const face of faces.filter((entry) => Number.isFinite(entry.px))) {
      expect(face.px, `${face.id} label size`).toBeGreaterThanOrEqual(MIN_TEXT_PX);
    }
  });
  test.describe("with Watch on", () => {
    const MAX_PREVIEW_PX = 80;
    const MIN_KEY_SCROLLER_PX = 120;

    const turnWatchOn = async (page: Page) => {
      await page.getByTestId("remote-input-mirror-controls").getByTestId("av-video-toggle").click();
      await expect(page.getByTestId("av-mirror-immersive")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(800);
    };

    test("joystick mode keeps the stick, FIRE and toolbar visible below a thin preview", async ({ page }) => {
      await turnWatchOn(page);
      const preview = await boxOf(page, "av-mirror-immersive");
      expect(preview.height, "the preview is a thin strip").toBeLessThanOrEqual(MAX_PREVIEW_PX);
      for (const id of [
        "remote-input-mode-joystick",
        "remote-input-panic-button",
        "remote-input-stick-zone",
        "remote-input-stick-thumb",
        "remote-input-fire-button",
        "remote-input-port-1",
        "remote-input-port-2",
      ]) {
        expectInsideViewport(id, await boxOf(page, id), WATCH_ON_BOTTOM_INSET_PX);
      }
      const body = page.locator('[data-testid="remote-input-sheet"] [data-surface-body="true"]');
      expect(await body.evaluate((el) => el.scrollTop), "the body has not scrolled").toBe(0);
    });

    test("adjusting the view keeps the mode chip whole inside the thin preview and drops the hint text", async ({
      page,
    }) => {
      await turnWatchOn(page);
      await page.getByTestId("remote-input-sheet").focus();
      await page.keyboard.press("*");
      await expect(page.getByTestId("av-mirror-immersive")).toHaveAttribute("data-mode", "adjust");

      const preview = await boxOf(page, "av-mirror-immersive");
      const chip = await boxOf(page, "av-mirror-mode-chip");
      expect(chip.x, "chip left edge").toBeGreaterThanOrEqual(preview.x);
      expect(chip.y, "chip top edge").toBeGreaterThanOrEqual(preview.y);
      expect(chip.y + chip.height, "chip bottom edge").toBeLessThanOrEqual(preview.y + preview.height);
      expect(chip.x + chip.width, "chip right edge").toBeLessThanOrEqual(preview.x + preview.width);
      await expect(page.getByTestId("av-mirror-mode-chip")).toHaveText("View");
      await expect(page.getByTestId("av-immersive-lock-hint")).toHaveCount(0);
      await expect(page.getByTestId("av-mirror-immersive-fps")).toHaveCount(0);
    });

    test("keys mode leaves the keyboard at least three key rows of height above the footer", async ({ page }) => {
      await turnWatchOn(page);
      await page.getByTestId("remote-input-mode-type").click();
      await page.waitForTimeout(500);
      const scroller = await boxOf(page, "remote-input-keyboard-scroll");
      const footer = await boxOf(page, "remote-input-mirror-controls");
      expect(scroller.height, "the key scroller height").toBeGreaterThanOrEqual(MIN_KEY_SCROLLER_PX);
      expect(scroller.y + scroller.height, "the scroller ends above the footer").toBeLessThanOrEqual(footer.y + 0.5);
      expectInsideViewport("the footer", footer, WATCH_ON_BOTTOM_INSET_PX);
    });
  });
});
