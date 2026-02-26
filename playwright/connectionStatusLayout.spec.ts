/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  try {
    await attachStepScreenshot(page, testInfo, label);
  } catch (error) {
    console.warn(`Step screenshot failed for "${label}"`, error);
  }
};

test.describe('Connection Status pop-up layout', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server?.close?.().catch(() => { });
    }
  });

  const openPopover = async (page: Page) => {
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 10000 });
    await indicator.click();
    const popover = page.getByTestId('connection-status-popover');
    await expect(popover).toBeVisible();
    return popover;
  };

  const seedOfflineState = async (page: Page) => {
    await page.addInitScript(() => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = 'http://127.0.0.1:1';
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '0');
      localStorage.setItem('c64u_startup_discovery_window_ms', '1000');
      localStorage.setItem('c64u_discovery_probe_timeout_ms', '600');
      localStorage.setItem('c64u_device_host', '127.0.0.1:1');
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
    });
  };

  test('row heights are equal for Status, Host and Last request', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(({ url }: { url: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
    }, { url: server.baseUrl });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const popover = await openPopover(page);

    const statusBox = await popover.getByTestId('connection-status-row-status').boundingBox();
    const hostBox = await popover.getByTestId('connection-status-row-host').boundingBox();
    const lastRequestBox = await popover.getByTestId('connection-status-row-last-request').boundingBox();

    expect(statusBox).toBeTruthy();
    expect(hostBox).toBeTruthy();
    expect(lastRequestBox).toBeTruthy();

    // Row heights must be equal within 1px tolerance.
    expect(Math.abs(statusBox!.height - hostBox!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(statusBox!.height - lastRequestBox!.height)).toBeLessThanOrEqual(1);

    // Vertical gap between Status→Host and Host→Last request must be equal within 1px.
    const gapStatusToHost = hostBox!.y - (statusBox!.y + statusBox!.height);
    const gapHostToLastRequest = lastRequestBox!.y - (hostBox!.y + hostBox!.height);
    expect(Math.abs(gapStatusToHost - gapHostToLastRequest)).toBeLessThanOrEqual(1);

    await snap(page, testInfo, 'connection-status-layout-rhythm');
  });

  test('Change button is a button element, focusable, and does not expand row height', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(({ url }: { url: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
    }, { url: server.baseUrl });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const popover = await openPopover(page);

    const changeButton = popover.getByRole('button', { name: 'Change' });
    await expect(changeButton).toBeVisible();

    // Must be a real button element.
    const tagName = await changeButton.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('button');

    // Must be focusable.
    await changeButton.focus();
    const focused = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    expect(focused).toBe('button');

    // Host row height must not exceed Status row height by more than 1px.
    const statusBox = await popover.getByTestId('connection-status-row-status').boundingBox();
    const hostBox = await popover.getByTestId('connection-status-row-host').boundingBox();
    expect(Math.abs(hostBox!.height - statusBox!.height)).toBeLessThanOrEqual(1);
  });

  test('all rows are flush-left aligned (no indentation)', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(({ url }: { url: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
    }, { url: server.baseUrl });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const popover = await openPopover(page);

    const statusBox = await popover.getByTestId('connection-status-row-status').boundingBox();
    const hostBox = await popover.getByTestId('connection-status-row-host').boundingBox();
    const lastRequestBox = await popover.getByTestId('connection-status-row-last-request').boundingBox();
    const restBox = await popover.getByTestId('connection-diagnostics-row-rest').boundingBox();

    // All rows must share the same left offset within 1px.
    expect(Math.abs(statusBox!.x - hostBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(statusBox!.x - lastRequestBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(statusBox!.x - restBox!.x)).toBeLessThanOrEqual(1);
  });

  test('Last request uses strict numeric format: Xs ago for under 60s', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');
    await seedOfflineState(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'OFFLINE_NO_DEMO', { timeout: 10000 });
    await indicator.click();
    const popover = page.getByTestId('connection-status-popover');
    await expect(popover).toBeVisible();

    // Must match numeric format; must NOT contain "just now" or "Communication".
    await expect(popover).toContainText(/Last request:\s+(\d+s ago|\d+m \d+s ago|none yet|unknown)/i);
    await expect(popover).not.toContainText('just now');
    await expect(popover).not.toContainText('Communication');
  });

  test('close icon closes the pop-up', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(({ url }: { url: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
    }, { url: server.baseUrl });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const popover = await openPopover(page);

    const closeButton = popover.getByTestId('connection-status-close');
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(popover).toBeHidden();
  });

  test('Escape key closes the pop-up', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(({ url }: { url: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
    }, { url: server.baseUrl });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const popover = await openPopover(page);
    await expect(popover).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
  });

  test('clicking outside closes the pop-up', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(({ url }: { url: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
    }, { url: server.baseUrl });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const popover = await openPopover(page);
    await expect(popover).toBeVisible();

    await page.mouse.click(10, 10);
    await expect(popover).toBeHidden();
  });

  test('spacing before Diagnostics is greater than spacing between Group 1 rows', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(({ url }: { url: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
    }, { url: server.baseUrl });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const popover = await openPopover(page);

    const statusBox = await popover.getByTestId('connection-status-row-status').boundingBox();
    const hostBox = await popover.getByTestId('connection-status-row-host').boundingBox();
    const lastRequestBox = await popover.getByTestId('connection-status-row-last-request').boundingBox();
    const diagnosticsSectionBox = await popover.getByTestId('connection-diagnostics-section').boundingBox();

    const intraGroupGap = hostBox!.y - (statusBox!.y + statusBox!.height);
    const interGroupGap = diagnosticsSectionBox!.y - (lastRequestBox!.y + lastRequestBox!.height);

    // Inter-group spacing must be strictly larger than intra-group spacing.
    expect(interGroupGap).toBeGreaterThan(intraGroupGap);
  });
});
