/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page, ElementHandle } from '@playwright/test';

export type RecoveryContext = {
  seed: number;
  sessionId: string;
  attempt: number;
};

export type RecoveryResult = {
  recovered: boolean;
  log: string;
  filledValues: string[];
  clicked: boolean;
};

const dialogSelector = '[role="dialog"], [data-radix-dialog-content], [data-state="open"][role="dialog"]';

const resolveDialogText = async (element: ElementHandle<HTMLElement>) =>
  element.evaluate((node) => (node.textContent || '').toLowerCase());

const resolveButtonText = async (element: ElementHandle<HTMLElement>) =>
  element.evaluate((node) => {
    const aria = node.getAttribute('aria-label') || '';
    const text = node.textContent || '';
    return `${aria} ${text}`.trim().toLowerCase();
  });

const isElementDisabled = async (element: ElementHandle<HTMLElement>) =>
  element.evaluate((node) => {
    const html = node as HTMLButtonElement | HTMLInputElement;
    return Boolean(html.disabled || html.getAttribute('aria-disabled') === 'true');
  });

const fillInput = async (page: Page, input: ElementHandle<HTMLElement>, value: string) => {
  const supportsFill = await input.evaluate((node) =>
    node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement,
  );
  await input.click().catch(() => {});
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  if (supportsFill) {
    await (input as ElementHandle<HTMLInputElement | HTMLTextAreaElement>).fill(value).catch(async () => {
      await page.keyboard.insertText(value);
    });
    return;
  }
  await page.keyboard.insertText(value);
};

const resolveInputHint = async (input: ElementHandle<HTMLElement>) =>
  input.evaluate((node) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return `${node.placeholder || ''} ${node.name || ''} ${node.getAttribute('aria-label') || ''}`.trim().toLowerCase();
    }
    return `${node.getAttribute('aria-label') || ''}`.trim().toLowerCase();
  });

const resolveRequiredToken = (dialogText: string, hint: string) => {
  const source = `${dialogText} ${hint}`;
  const explicit = source.match(/(?:type|enter)\s+["']?([a-z]+)["']?/i);
  const token = explicit?.[1]?.toLowerCase();
  if (token === 'delete' || token === 'confirm' || token === 'yes') return token;
  if (source.includes('delete')) return 'delete';
  if (source.includes('confirm')) return 'confirm';
  return null;
};

const buildRecoveryValue = (context: RecoveryContext, hint: string, index: number) => {
  if (hint.includes('email')) {
    return `fuzz-${context.seed}-${context.attempt}@example.com`;
  }
  if (hint.includes('number')) {
    return String(1000 + context.attempt + index);
  }
  if (hint.includes('name') || hint.includes('title') || hint.includes('config')) {
    return `fuzz-config-${context.seed}-${context.attempt}-${index + 1}`;
  }
  return `fuzz-${context.seed}-${context.sessionId}-${context.attempt}-${index + 1}`;
};

const pickPrimaryButton = async (buttons: ElementHandle<HTMLElement>[]) => {
  const positive = /(confirm|continue|ok|yes|save|delete|submit|apply|proceed|add|create|done)/i;
  const negative = /(cancel|close|dismiss|back|no)/i;
  const scored: Array<{ button: ElementHandle<HTMLElement>; score: number; label: string }> = [];
  for (const button of buttons) {
    if (!(await button.isVisible())) continue;
    if (await isElementDisabled(button)) continue;
    const label = await resolveButtonText(button);
    let score = 0;
    if (!label) score -= 1;
    if (positive.test(label)) score += 3;
    if (negative.test(label)) score -= 2;
    scored.push({ button, score, label });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
};

export const attemptStructuredRecovery = async (
  page: Page,
  context: RecoveryContext,
): Promise<RecoveryResult> => {
  const dialog = await page.$(dialogSelector);
  const scope = dialog ?? (await page.$('main')) ?? null;
  if (!scope) {
    return { recovered: false, log: 'recovery skip (no scope)', filledValues: [], clicked: false };
  }

  const dialogText = dialog ? await resolveDialogText(dialog as ElementHandle<HTMLElement>) : '';
  const inputSelector = 'input:not([type]), input[type="text"], input[type="search"], textarea, [contenteditable="true"]';
  let inputs = await scope.$$(inputSelector);
  if (!inputs.length) {
    const fallback = await (dialog ? page.locator(dialogSelector) : page.locator('main'))
      .locator(inputSelector)
      .elementHandles();
    inputs = fallback as ElementHandle<HTMLElement>[];
  }
  const filledValues: string[] = [];

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (!(await input.isVisible())) continue;
    const value = await input.evaluate((node) => {
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        return node.value || '';
      }
      return (node.textContent || '').trim();
    });
    const hint = await resolveInputHint(input as ElementHandle<HTMLElement>);
    const requiredToken = resolveRequiredToken(dialogText, hint);
    const safeValue = requiredToken ?? buildRecoveryValue(context, hint, index);
    if (value.trim() === safeValue) continue;
    await fillInput(page, input as ElementHandle<HTMLElement>, safeValue);
    filledValues.push(safeValue);
  }

  const locatorScope = dialog ? page.locator(dialogSelector) : page.locator('main');
  const primaryLocator = locatorScope.getByRole('button', {
    name: /(save|confirm|ok|continue|yes|submit|apply|done|delete|proceed|add|create)/i,
  });
  if (await primaryLocator.count()) {
    await primaryLocator.first().click().catch(() => {});
    return {
      recovered: true,
      log: 'recovery click primary locator',
      filledValues,
      clicked: true,
    };
  }

  const buttons = await scope.$$('button, [role="button"]');
  const primary = await pickPrimaryButton(buttons as ElementHandle<HTMLElement>[]);
  if (primary) {
    await primary.button.click().catch(() => {});
    return {
      recovered: true,
      log: `recovery click "${primary.label || 'button'}"`,
      filledValues,
      clicked: true,
    };
  }

  if (dialog) {
    await page.keyboard.press('Escape').catch(() => {});
    return { recovered: true, log: 'recovery escape', filledValues, clicked: false };
  }

  return { recovered: false, log: 'recovery no-action', filledValues, clicked: false };
};
