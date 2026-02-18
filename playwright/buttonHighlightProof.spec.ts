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

        const tryObserveFlash = async () => {
            return Promise.all([
                target.evaluate((element) => {
                    return new Promise<boolean>((resolve) => {
                        const attr = 'data-c64-tap-flash';
                        if (element.getAttribute(attr) === 'true') {
                            resolve(true);
                            return;
                        }

                        const observer = new MutationObserver(() => {
                            if (element.getAttribute(attr) === 'true') {
                                observer.disconnect();
                                resolve(true);
                            }
                        });

                        observer.observe(element, { attributes: true, attributeFilter: [attr] });
                        setTimeout(() => {
                            observer.disconnect();
                            resolve(element.getAttribute(attr) === 'true');
                        }, 2500);
                    });
                }),
                target.click({ force: true, timeout: 60000 }),
            ]).then(([observed]) => observed);
        };

        let sawFlash = false;
        for (let attempt = 0; attempt < 3 && !sawFlash; attempt += 1) {
            sawFlash = await tryObserveFlash();
            if (!sawFlash) {
                await page.waitForTimeout(200);
            }
        }

        expect(sawFlash).toBe(true);

        const activePath = testInfo.outputPath('button-highlight-active.png');
        await target.screenshot({ path: activePath });
        await testInfo.attach('button-highlight-active', {
            path: activePath,
            contentType: 'image/png',
        });

        await page.waitForTimeout(400);

        await expect(target).not.toHaveAttribute('data-c64-tap-flash', 'true');

        const clearedPath = testInfo.outputPath('button-highlight-cleared.png');
        await target.screenshot({ path: clearedPath });
        await testInfo.attach('button-highlight-cleared', {
            path: clearedPath,
            contentType: 'image/png',
        });
    });
});
