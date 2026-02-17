import { expect, test } from '@playwright/test';

test.describe('CTA highlight proof', () => {
    test('connectivity indicator flash clears after transient timeout', async ({ page }, testInfo) => {
        await page.goto('/');

        const continueDemo = page.getByRole('button', { name: 'Continue in Demo Mode' });
        if (await continueDemo.isVisible().catch(() => false)) {
            await continueDemo.click();
        }

        const target = page.getByTestId('connectivity-indicator');
        await expect(target).toBeVisible();
        await target.scrollIntoViewIfNeeded();

        await target.click({ force: true, timeout: 60000 });
        await expect(target).toHaveAttribute('data-c64-tap-flash', 'true');

        const activePath = testInfo.outputPath('button-highlight-active.png');
        await target.screenshot({ path: activePath });
        await testInfo.attach('button-highlight-active', {
            path: activePath,
            contentType: 'image/png',
        });

        await page.waitForTimeout(320);

        await expect(target).not.toHaveAttribute('data-c64-tap-flash', 'true');

        const clearedPath = testInfo.outputPath('button-highlight-cleared.png');
        await target.screenshot({ path: clearedPath });
        await testInfo.attach('button-highlight-cleared', {
            path: clearedPath,
            contentType: 'image/png',
        });
    });
});
