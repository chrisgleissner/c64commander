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
import '../tests/mocks/setupMockConfigForTests';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import {
    assertNoUiIssues,
    finalizeEvidence,
    startStrictUiMonitoring,
} from './testArtifacts';
import { disableTraceAssertions } from './traceUtils';
import {
    installFixedClock,
    installListPreviewLimit,
    installLocalSourceSeed,
    installStableStorage,
    seedDiagnosticsTraces,
} from './visualSeeds';

const TOP_PAUSE_MS = 3000;
const SHORT_PAUSE_MS = 800;
const SCROLL_DURATION_MS = 9000;

const waitForConnected = async (page: Page) => {
    await expect(page.getByTestId('connectivity-indicator')).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 10000 });
};

const pauseAtTop = async (page: Page, delayMs = TOP_PAUSE_MS) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(delayMs);
};

const smoothScrollTo = async (page: Page, targetY: number, durationMs: number) => {
    await page.evaluate(async ({ targetY, durationMs }) => {
        const startY = window.scrollY;
        const delta = targetY - startY;
        const clamp = (value: number) => Math.max(0, value);
        const start = performance.now();
        const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
        await new Promise<void>((resolve) => {
            const step = (now: number) => {
                const progress = Math.min(1, (now - start) / durationMs);
                const eased = easeInOut(progress);
                window.scrollTo(0, clamp(startY + delta * eased));
                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }, { targetY, durationMs });
};

const smoothScrollToLocator = async (page: Page, locator: ReturnType<Page['locator']>, durationMs: number) => {
    const targetY = await locator.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top + window.scrollY - 12;
    });
    await smoothScrollTo(page, targetY, durationMs);
};

const smoothScrollToBottom = async (page: Page, durationMs: number) => {
    const targetY = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
    await smoothScrollTo(page, targetY, durationMs);
};

const openAndCloseSelect = async (page: Page, trigger: ReturnType<Page['locator']>) => {
    if (await trigger.count() === 0) {
        return;
    }
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(SHORT_PAUSE_MS);
};

const openAndCloseDialog = async (page: Page, trigger: ReturnType<Page['locator']>, dialogName?: string) => {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    if (dialogName) {
        await expect(page.getByRole('dialog', { name: dialogName })).toBeVisible();
    } else {
        await expect(page.getByRole('dialog')).toBeVisible();
    }
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(SHORT_PAUSE_MS);
};

const tourHome = async (page: Page) => {
    await page.goto('/');
    await waitForConnected(page);
    await expect(page.getByRole('button', { name: 'Disks', exact: true })).toBeVisible();

    await pauseAtTop(page);

    const systemInfo = page.getByTestId('home-system-info');
    await systemInfo.click();
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await smoothScrollToLocator(page, page.getByTestId('home-machine-controls'), 1800);
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await smoothScrollToLocator(page, page.getByTestId('home-quick-config'), 1800);
    await openAndCloseSelect(page, page.getByTestId('home-video-mode'));

    await smoothScrollToLocator(page, page.getByTestId('home-led-summary'), 1800);
    await openAndCloseSelect(page, page.getByTestId('home-led-tint'));

    await smoothScrollToLocator(page, page.getByTestId('home-drives-group'), 2000);
    await openAndCloseSelect(page, page.getByTestId('home-drive-type-a'));

    await smoothScrollToLocator(page, page.getByTestId('home-printer-group'), 2000);
    await openAndCloseSelect(page, page.getByTestId('home-printer-bus'));

    await smoothScrollToLocator(page, page.getByTestId('home-sid-status'), 2200);
    const panSlider = page.getByTestId('home-sid-pan-socket1').getByRole('slider');
    const panBox = await panSlider.boundingBox();
    if (panBox) {
        await panSlider.click({ position: { x: panBox.width * 0.8, y: panBox.height / 2 } });
        await page.waitForTimeout(SHORT_PAUSE_MS);
    }

    await smoothScrollToLocator(page, page.getByTestId('home-stream-status'), 2200);
    const streamEdit = page.getByTestId('home-stream-edit-toggle-audio');
    if (await streamEdit.count()) {
        await streamEdit.click();
        await page.waitForTimeout(SHORT_PAUSE_MS);
        await page.getByTestId('home-stream-cancel-audio').click();
        await page.waitForTimeout(SHORT_PAUSE_MS);
    }

    await smoothScrollToBottom(page, 2800);
    const saveAppButton = page.getByTestId('home-config-save-app');
    await openAndCloseDialog(page, saveAppButton, 'Save to App');

    await smoothScrollToBottom(page, 2000);
    await page.waitForTimeout(1000);
};

const tourDisks = async (page: Page) => {
    await page.goto('/disks');
    await expect(page.getByRole('heading', { name: 'Disks', level: 1 })).toBeVisible();
    await pauseAtTop(page);

    const viewAll = page.getByRole('button', { name: 'View all' });
    await viewAll.scrollIntoViewIfNeeded();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await viewAll.click();
    await expect(page.getByTestId('action-list-view-all')).toBeVisible();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await smoothScrollToBottom(page, SCROLL_DURATION_MS);
};

const tourPlay = async (page: Page) => {
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await pauseAtTop(page);

    await smoothScrollToLocator(page, page.getByTestId('play-section-playback'), 2200);
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await smoothScrollToLocator(page, page.getByTestId('play-section-playlist'), 2200);
    const addItemsButton = page.getByRole('button', { name: /Add items|Add more items/i });
    await addItemsButton.scrollIntoViewIfNeeded();
    await addItemsButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(SHORT_PAUSE_MS);

    const viewAll = page.getByRole('button', { name: 'View all' });
    await viewAll.scrollIntoViewIfNeeded();
    await viewAll.click();
    await expect(page.getByTestId('action-list-view-all')).toBeVisible();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await smoothScrollToBottom(page, SCROLL_DURATION_MS);
};

const tourConfig = async (page: Page) => {
    await page.goto('/config');
    await expect(page.getByRole('heading', { name: 'Config' })).toBeVisible();
    await pauseAtTop(page);

    const audioMixerToggle = page.getByTestId('config-category-audio-mixer');
    await audioMixerToggle.scrollIntoViewIfNeeded();
    await audioMixerToggle.click();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await audioMixerToggle.click();
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await smoothScrollToBottom(page, SCROLL_DURATION_MS);
};

const tourSettings = async (page: Page) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await pauseAtTop(page);

    await smoothScrollToLocator(page, page.getByRole('heading', { name: 'Connection' }), 2000);
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await page.waitForFunction(() => Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces));
    await seedDiagnosticsTraces(page);

    const diagnosticsButton = page.getByRole('button', { name: 'Diagnostics', exact: true });
    await diagnosticsButton.scrollIntoViewIfNeeded();
    await diagnosticsButton.click();
    const dialog = page.getByRole('dialog', { name: 'Diagnostics' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await dialog.getByRole('tab', { name: 'Traces' }).click();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await dialog.getByRole('tab', { name: 'Logs' }).click();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await dialog.getByRole('tab', { name: 'Errors' }).click();
    await page.waitForTimeout(SHORT_PAUSE_MS);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(SHORT_PAUSE_MS);

    await smoothScrollToBottom(page, SCROLL_DURATION_MS);
};

const tourDocs = async (page: Page) => {
    await page.goto('/docs');
    await expect(page.getByRole('heading', { name: 'Docs' })).toBeVisible();
    await pauseAtTop(page);

    const buttons = page.locator('main button').filter({ hasText: /^[A-Za-z]/ });
    const count = await buttons.count();
    for (let index = 0; index < Math.min(3, count); index += 1) {
        const button = buttons.nth(index);
        await button.scrollIntoViewIfNeeded();
        await button.click();
        await page.waitForTimeout(SHORT_PAUSE_MS);
        await button.click();
        await page.waitForTimeout(SHORT_PAUSE_MS);
    }

    await smoothScrollToBottom(page, SCROLL_DURATION_MS);
};

test.describe('App video tour', () => {
    let server: Awaited<ReturnType<typeof createMockC64Server>>;
    let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

    test.setTimeout(5 * 60 * 1000);

    test.use({
        locale: 'en-US',
        timezoneId: 'UTC',
        viewport: { width: 720, height: 1280 },
    });

    test.beforeAll(async () => {
        ftpServers = await startFtpTestServers();
        server = await createMockC64Server();
    });

    test.afterAll(async () => {
        await ftpServers.close();
        await server.close();
    });

    test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
        disableTraceAssertions(testInfo, 'Video tour only; trace assertions disabled.');
        await startStrictUiMonitoring(page, testInfo);
        await installFixedClock(page);
        await seedFtpConfig(page, {
            host: ftpServers.ftpServer.host,
            port: ftpServers.ftpServer.port,
            bridgeUrl: ftpServers.bridgeServer.baseUrl,
            password: '',
        });
        await seedUiMocks(page, server.baseUrl);
        await installStableStorage(page);
        await installLocalSourceSeed(page);
        await installListPreviewLimit(page, 4);
    });

    test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
        try {
            await assertNoUiIssues(page, testInfo);
        } finally {
            await finalizeEvidence(page, testInfo);
        }
    });

    test('records full app walkthrough', { tag: '@video' }, async ({ page }: { page: Page }) => {
        await tourHome(page);
        await tourDisks(page);
        await tourPlay(page);
        await tourConfig(page);
        await tourSettings(page);
        await tourDocs(page);
    });
});
