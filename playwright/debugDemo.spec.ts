import { test, expect, Page } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { allowWarnings, startStrictUiMonitoring } from './testArtifacts';
import { enableGoldenTrace } from './goldenTraceRegistry';

test('debug demo dialog timing', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    test.setTimeout(30000);

    const server = await createMockC64Server({});

    await page.addInitScript(() => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = 'http://127.0.0.1:1';
        (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = ['http://127.0.0.1:1'];
        localStorage.setItem('c64u_startup_discovery_window_ms', '600');
        localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
        localStorage.setItem('c64u_background_rediscovery_interval_ms', '5000');
        localStorage.setItem('c64u_device_host', '127.0.0.1:1');
        localStorage.removeItem('c64u_password');
        localStorage.removeItem('c64u_has_password');
        sessionStorage.removeItem('c64u_demo_interstitial_shown');
        delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const start = Date.now();

    // The exact same assertion as the original test
    const dialog = page.getByRole('dialog', { name: 'Demo Mode' });
    try {
        await expect(dialog).toBeVisible({ timeout: 10000 });
        console.log(`Dialog VISIBLE at ${Date.now() - start}ms`);
    } catch {
        console.log(`Dialog FAILED at ${Date.now() - start}ms`);
        const exists = await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            return d ? `IN DOM, opacity=${getComputedStyle(d).opacity}` : 'NOT IN DOM';
        });
        console.log(`Manual: ${exists}`);
    }

    await server?.close?.().catch(() => { });
});


