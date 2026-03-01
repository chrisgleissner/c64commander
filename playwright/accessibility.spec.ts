import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = ['/'];

for (const route of routes) {
    test(`a11y: critical violations on ${route}`, async ({ page }) => {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        const criticalViolations = results.violations.filter((violation) => violation.impact === 'critical');
        expect(criticalViolations.length).toBeLessThanOrEqual(5);
    });
}
