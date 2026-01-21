import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('http://127.0.0.1:4173');
  await page.waitForLoadState('networkidle');
  
  const hasCoverage = await page.evaluate(() => {
    return typeof window.__coverage__ !== 'undefined';
  });
  
  console.log('Has coverage object:', hasCoverage);
  
  if (hasCoverage) {
    const coverageKeys = await page.evaluate(() => {
      return Object.keys(window.__coverage__).length;
    });
    console.log('Number of instrumented files:', coverageKeys);
  }
  
  await browser.close();
})();
