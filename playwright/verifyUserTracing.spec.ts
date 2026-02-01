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
  // The component wrapper emits with component='DriveTile' and name='click Drive A'
  const driveClick = userActions.find((t: any) => 
    t.data?.name.includes('Drive A') && t.data?.component === 'DriveTile');
  expect(driveClick).toBeDefined();
  expect(driveClick.data.component).toBe('DriveTile');

  // Verify Tab click
  // The component wrapper emits with component='Tab' and name='click Config'
  // Note: GlobalInteraction also emits a trace for the same click, so we filter by component
  const tabClick = userActions.find((t: any) => 
    t.data?.name.includes('Config') && t.data?.component === 'Tab');
  expect(tabClick).toBeDefined();
  expect(tabClick.data.component).toBe('Tab');
});
