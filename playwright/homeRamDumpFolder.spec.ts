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
import { seedUiMocks, uiFixtures } from './uiMocks';
import { saveCoverageFromPage } from './withCoverage';
import { attachStepScreenshot, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { enforceDeviceTestMapping } from './layoutTest';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
};

test.describe('Home RAM dump folder display', () => {
    let server: Awaited<ReturnType<typeof createMockC64Server>>;

    test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
        enforceDeviceTestMapping(testInfo);
        await startStrictUiMonitoring(page, testInfo);
        server = await createMockC64Server(uiFixtures.configState);
        await seedUiMocks(page, server.baseUrl);
        await page.addInitScript(() => {
            const folder = {
                treeUri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fc64',
                rootName: 'c64',
                selectedAt: new Date().toISOString(),
            };
            localStorage.setItem('c64u_ram_dump_folder:v1', JSON.stringify(folder));
        });
    });

    test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
        try {
            await saveCoverageFromPage(page, testInfo.title);
            await assertNoUiIssues(page, testInfo);
        } finally {
            await finalizeEvidence(page, testInfo);
            await server.close();
        }
    });

    test('shows derived SAF display path @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        await page.goto('/');
        await snap(page, testInfo, 'home-open');

        await expect(page.getByTestId('home-quick-config')).toBeVisible();

        await page.evaluate(() => {
            const folder = {
                treeUri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fc64',
                rootName: 'c64',
                selectedAt: new Date().toISOString(),
            };
            localStorage.setItem('c64u_ram_dump_folder:v1', JSON.stringify(folder));
            window.dispatchEvent(new CustomEvent('c64u-ram-dump-folder-updated', { detail: folder }));
        });

        const label = page.getByTestId('ram-dump-folder-value');

        await expect(label).toHaveText('c64');
        await expect(page.getByText('Internal storage/Download/c64')).toBeVisible();
        await snap(page, testInfo, 'ram-dump-folder');
    });
});
