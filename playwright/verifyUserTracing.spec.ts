import { test, expect } from '@playwright/test';

test('verify comprehensive user tracing', async ({ page }) => {
  const dismissDialogIfPresent = async (dialog: ReturnType<typeof page.getByRole>) => {
    const isVisible = await dialog.isVisible().catch(() => false);
    if (!isVisible) {
      return false;
    }

    const continueInDemoMode = dialog.getByRole('button', { name: /continue in demo mode/i }).first();
    if (await continueInDemoMode.isVisible().catch(() => false)) {
      await continueInDemoMode.click();
      await expect(dialog).toBeHidden({ timeout: 10000 });
      return true;
    }

    const closeButton = dialog.getByRole('button', { name: /close|dismiss|ok|cancel/i }).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await expect(dialog).toBeHidden({ timeout: 10000 });
      return true;
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10000 });
    return true;
  };

  const dismissBlockingDialogIfPresent = async () => {
    const dialog = page.getByRole('dialog').last();
    const alertDialog = page.getByRole('alertdialog').last();
    const dialogClosed = await dismissDialogIfPresent(dialog);
    if (dialogClosed) return;
    await dismissDialogIfPresent(alertDialog);
  };

  const clickWithRetry = async (locator: ReturnType<typeof page.locator>, label: string) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await dismissBlockingDialogIfPresent();
      await locator.scrollIntoViewIfNeeded();
      await expect(locator).toBeVisible();
      try {
        await locator.click({ timeout: 10000 });
        return;
      } catch (error) {
        if (attempt === 0) {
          console.warn(`${label} click blocked; retrying after dismissing overlays.`, error);
          continue;
        }
        throw error;
      }
    }
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
  await clickWithRetry(page.locator('.tab-item').filter({ hasText: 'Disks' }), 'Disks tab');
  await page.waitForURL('**/disks');

  // 2. Click Tab Bar "Config" (TabBar)
  await dismissDemoInterstitialIfPresent();
  await clickWithRetry(page.locator('.tab-item').filter({ hasText: 'Config' }), 'Config tab');
  await page.waitForURL('**/config');

  // 3. Open diagnostics from header indicator
  const connectivityIndicator = page.getByTestId('connectivity-indicator');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dismissBlockingDialogIfPresent();
    await connectivityIndicator.scrollIntoViewIfNeeded();
    await expect(connectivityIndicator).toBeVisible();
    try {
      await connectivityIndicator.click({ timeout: 10000 });
      break;
    } catch (error) {
      if (attempt === 0) {
        console.warn('Connectivity indicator click blocked; retrying after dismissing overlays.', error);
        continue;
      }
      throw error;
    }
  }

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
