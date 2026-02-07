import { test, expect } from '@playwright/test';

test('verify comprehensive user tracing', async ({ page }) => {
  const dismissBlockingDialogIfPresent = async () => {
    const dialog = page.getByRole('dialog').last();
    const isVisible = await dialog.isVisible().catch(() => false);
    if (!isVisible) {
      return;
    }

    const continueInDemoMode = dialog.getByRole('button', { name: /continue in demo mode/i }).first();
    if (await continueInDemoMode.isVisible().catch(() => false)) {
      await continueInDemoMode.click();
      await expect(dialog).toBeHidden({ timeout: 10000 });
      return;
    }

    const closeButton = dialog.getByRole('button', { name: /close|dismiss|ok|cancel/i }).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await expect(dialog).toBeHidden({ timeout: 10000 });
      return;
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10000 });
  };

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Wait for tracing bridge
  await page.waitForFunction(() => (window as any).__c64uTracing);

  const dismissDemoInterstitialIfPresent = async () => {
    const dialog = page.getByRole('dialog');
    const demoBtn = page.getByRole('button', { name: /continue in demo mode/i });
    const visible = await demoBtn.isVisible().catch(() => false);
    if (!visible) {
      return;
    }
    await demoBtn.click();
    await dialog.waitFor({ state: 'hidden', timeout: 15000 });
  };

  // Handle discovery dialog if it appears (can show after initial load)
  await dismissDemoInterstitialIfPresent();

  // Clear traces first
  await page.evaluate(() => (window as any).__c64uTracing?.clearTraces());

  // 1. Navigate via tab bar to Disks
  await dismissDemoInterstitialIfPresent();
  await page.locator('.tab-item').filter({ hasText: 'Disks' }).click();
  await page.waitForURL('**/disks');

  // 2. Click Tab Bar "Config" (TabBar)
  await dismissDemoInterstitialIfPresent();
  await page.locator('.tab-item').filter({ hasText: 'Config' }).click();
  await page.waitForURL('**/config');

  // 3. Open diagnostics from header indicator
  await dismissBlockingDialogIfPresent();
  await page.getByTestId('connectivity-indicator').click();

  // Get traces
  const traces: any[] = await page.evaluate(() => (window as any).__c64uTracing?.getTraces());
  
  console.log('Total traces:', traces?.length);
  const userActions = traces.filter((t: any) => t.origin === 'user' && t.type === 'action-start');
  
  console.log('Captured User Actions:');
  userActions.forEach(t => console.log(`- ${t.data?.name}`));

  const disksTabClick = userActions.find((t: any) =>
    t.data?.component === 'Tab' && t.data?.name.includes('Disks'));
  expect(disksTabClick).toBeDefined();
  expect(disksTabClick.data.component).toBe('Tab');

  const configTabClick = userActions.find((t: any) => 
    t.data?.name.includes('Config') && t.data?.component === 'Tab');
  expect(configTabClick).toBeDefined();
  expect(configTabClick.data.component).toBe('Tab');

  const connectivityClick = userActions.find((t: any) => t.data?.component === 'ConnectivityIndicator');
  expect(connectivityClick).toBeDefined();
  expect(connectivityClick.data.component).toBe('ConnectivityIndicator');
});
