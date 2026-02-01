import { test, expect } from '@playwright/test';

test('verify comprehensive user tracing', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Wait for tracing bridge
  await page.waitForFunction(() => (window as any).__c64uTracing);

  const dismissDemoInterstitialIfPresent = async () => {
    const dialog = page.getByRole('dialog');
    const demoBtn = page.getByRole('button', { name: /continue in demo mode/i });

    try {
      await demoBtn.waitFor({ state: 'visible', timeout: 15000 });
      await demoBtn.click();
      await dialog.waitFor({ state: 'hidden', timeout: 15000 });
    } catch (e) {
      // Dialog didn't appear, ignore
    }
  };

  // Handle discovery dialog if it appears (can show after initial load)
  await dismissDemoInterstitialIfPresent();

  // Clear traces first
  await page.evaluate(() => (window as any).__c64uTracing?.clearTraces());

  // 1. Click Drive A tile (HomePage)
  await dismissDemoInterstitialIfPresent();
  await page.getByLabel('Open Disks').first().click();
  await page.waitForURL('**/disks');

  // 2. Click Tab Bar "Config" (TabBar)
  await dismissDemoInterstitialIfPresent();
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
