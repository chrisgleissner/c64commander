import { expect, type Locator, type Page } from "@playwright/test";

export const getOpenToast = (page: Page, text: string): Locator =>
  page.locator('[data-testid="app-toast"][data-state="open"]').filter({ hasText: text }).first();

export const expectOpenToast = async (page: Page, text: string) => {
  await expect(getOpenToast(page, text)).toBeVisible();
};
