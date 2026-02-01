import { test, expect } from '@playwright/test';

test('verify comprehensive user tracing', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Wait for tracing bridge
  await page.waitForFunction(() => (window as any).__c64uTracing);

  // Handle discovery dialog if it appears
  const dialog = page.getByRole('dialog');
  // It might take a moment to appear
  try {
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
    const demoBtn = dialog.getByRole('button', { name: /demo/i });
    if (await demoBtn.isVisible()) {
        await demoBtn.click();
    } else {
        await dialog.press('Escape');
    }
    await expect(dialog).not.toBeVisible();
  } catch (e) {
    // Dialog didn't appear, ignore
  }

  // Clear traces first
  await page.evaluate(() => (window as any).__c64uTracing?.clearTraces());

  // 1. Click Drive A tile (HomePage)
  await page.getByLabel('Open Disks').first().click();
  await page.waitForURL('**/disks');

  // 2. Click Tab Bar "Config" (TabBar)
  // The tab bar button has text "Config" inside a span.
  await page.locator('.tab-item').filter({ hasText: 'Config' }).click();
  await page.waitForURL('**/config');

  // Get traces
  const traces: any[] = await page.evaluate(() => (window as any).__c64uTracing?.getTraces());
  
  console.log('Total traces:', traces?.length);
  const userActions = traces.filter((t: any) => t.origin === 'user' && t.type === 'action-start');
  
  console.log('Captured User Actions:');
  userActions.forEach(t => console.log(`- ${t.data?.name}`));

  // Verify DriveTile click
  // Name should be "click DriveTile" (title='Drive A' passed? No, I passed title='Drive A', so name is "click Drive A")
  // Wait, I passed: wrapUserEvent(..., 'click', 'DriveTile', { title: 'Drive A' }, 'DriveTile')
  // getMeaningfulName uses props['title'] -> 'Drive A'.
  // actionName -> "click Drive A"
  
  const driveClick = userActions.find((t: any) => t.data?.name.includes('Drive A'));
  expect(driveClick).toBeDefined();
  expect(driveClick.data.component).toBe('DriveTile');

  // Verify Tab click
  // I passed: wrapUserEvent(..., 'click', 'Tab', { title: tab.label }, 'Tab')
  // title -> "Config"
  // name -> "click Config"
  
  const tabClick = userActions.find((t: any) => t.data?.name.includes('Config'));
  expect(tabClick).toBeDefined();
  expect(tabClick.data.component).toBe('Tab');
});
