/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { seedFtpConfig, startFtpTestServers, type FtpTestServers } from "./ftpTestUtils";
import { clickSourceSelectionButton } from "./sourceSelection";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { enableKeypad } from "./focusRing";

/**
 * Where an error reaches the user on the smallest screen.
 *
 * A folder the C64 could not read raised a toast that was drawn under the open browser (z-index 100
 * against the dialog's 210), so nothing happened on screen. It appeared after the browser closed,
 * over 40% of the page, pushed the keypad guidance bar up, and was raised again on every reopen.
 */

const UNREADABLE_FOLDER = "Locked";

const isOnTop = (target: Locator) =>
  target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && element.contains(hit));
  });

const openAddDisks = async (page: Page) => {
  const addButton = page.getByRole("button", { name: /Add disks|Add more disks/i });
  await expect(addButton).toBeVisible({ timeout: 30_000 });
  await addButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const waitForFtpIdle = async (page: Page) => {
  const loading = page.getByTestId("ftp-loading");
  if (await loading.count()) await expect(loading).toBeHidden({ timeout: 15_000 });
};

const openC64UltimateRoot = async (page: Page) => {
  const dialog = await openAddDisks(page);
  await clickSourceSelectionButton(dialog, "C64 Ultimate");
  await waitForFtpIdle(page);
  const root = dialog.getByTestId("navigate-root");
  if ((await root.isVisible()) && (await root.isEnabled())) {
    await root.click();
    await waitForFtpIdle(page);
  }
  return dialog;
};

/** A stand-in toast of a known height in the real strip, so the strip's own measuring and placing is what is tested. */
const showToastOfHeight = (page: Page, heightPx: number) =>
  page.evaluate((height) => {
    const strip = document.querySelector(".toast-viewport");
    if (!strip) throw new Error("No toast strip");
    const toast = document.createElement("li");
    toast.setAttribute("data-testid", "probe-toast");
    toast.style.cssText = `height:${height}px;pointer-events:auto;background:#c00;list-style:none`;
    strip.appendChild(toast);
  }, heightPx);

const rectOf = (target: Locator) => target.evaluate((element) => element.getBoundingClientRect().toJSON());

test.describe("Browse errors and toasts on a 320x427 screen", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftp: FtpTestServers;
  let lockedFolder: string;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Error placement coverage; trace assertions disabled.");
    ftp = await startFtpTestServers();
    lockedFolder = path.join(ftp.ftpServer.rootDir, UNREADABLE_FOLDER);
    await fs.mkdir(lockedFolder, { recursive: true });
    await fs.chmod(lockedFolder, 0o000);
    server = await createMockC64Server({});
    await seedFtpConfig(page, {
      host: ftp.ftpServer.host,
      port: ftp.ftpServer.port,
      bridgeUrl: ftp.bridgeServer.baseUrl,
      password: "",
    });
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await fs.chmod(lockedFolder, 0o755).catch((error: Error) => {
      throw new Error(`Could not restore permissions on ${lockedFolder}: ${error.message}`);
    });
    await ftp.close();
    await server.close();
  });

  test("shows a folder that cannot be read inside the browser and reopens at the last folder that worked", async ({
    page,
  }) => {
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    let dialog = await openC64UltimateRoot(page);
    await dialog.locator('[data-testid="source-entry-row"]', { hasText: UNREADABLE_FOLDER }).first().click();

    const message = dialog.getByRole("alert");
    await expect(message).toBeVisible({ timeout: 15_000 });
    expect(await isOnTop(message)).toBe(true);
    const box = (await message.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(await message.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(
      15.9,
    );
    await expect(page.getByTestId("app-toast")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("app-toast")).toHaveCount(0);

    dialog = await openAddDisks(page);
    await clickSourceSelectionButton(dialog, "C64 Ultimate");
    await waitForFtpIdle(page);
    await expect(dialog.locator('[data-testid="source-entry-row"]', { hasText: UNREADABLE_FOLDER })).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(page.getByTestId("app-toast")).toHaveCount(0);
  });

  test("draws a toast above an open dialog, which ends above the toast", async ({ page }) => {
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    const dialog = await openC64UltimateRoot(page);
    const surface = dialog;

    await showToastOfHeight(page, 80);
    const toast = page.getByTestId("probe-toast");
    await expect(toast).toBeVisible();
    await expect.poll(async () => (await rectOf(surface)).bottom).toBeLessThanOrEqual((await rectOf(toast)).top + 0.5);
    expect(await isOnTop(toast)).toBe(true);
  });

  test("keeps the keypad guidance bar in place when a toast appears", async ({ page }) => {
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    await page.keyboard.press("ArrowDown");
    const bar = page.getByTestId("keypad-guidance-bar");
    await expect(bar).toHaveAttribute("data-visible", "true");
    const before = await rectOf(bar);

    await showToastOfHeight(page, 120);
    const toast = page.getByTestId("probe-toast");
    await expect(toast).toBeVisible();
    await page.waitForTimeout(200);

    const after = await rectOf(bar);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect((await rectOf(toast)).bottom).toBeLessThanOrEqual(after.top + 0.5);
  });
});
