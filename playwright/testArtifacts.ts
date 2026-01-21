import type { Page, TestInfo } from '@playwright/test';

const sanitizeLabel = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]+/g, '');

type StrictUiTracker = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  toastIssues: string[];
  detach: () => void;
};

type ToastIssue = { type: string; message: string };

const getStepIndex = (testInfo: TestInfo) => {
  const info = testInfo as TestInfo & { __stepIndex?: number };
  info.__stepIndex = (info.__stepIndex ?? 0) + 1;
  return info.__stepIndex;
};

const getTracker = (testInfo: TestInfo) =>
  (testInfo as TestInfo & { __strictUiTracker?: StrictUiTracker }).__strictUiTracker;

const setTracker = (testInfo: TestInfo, tracker: StrictUiTracker) => {
  (testInfo as TestInfo & { __strictUiTracker?: StrictUiTracker }).__strictUiTracker = tracker;
};

export const attachStepScreenshot = async (page: Page, testInfo: TestInfo, label: string) => {
  const safe = sanitizeLabel(label);
  const step = String(getStepIndex(testInfo)).padStart(2, '0');
  const name = safe.length ? `${step}-${safe}.png` : `${step}-step.png`;
  const filePath = testInfo.outputPath(name);
  await page.screenshot({ path: filePath, fullPage: true });
  await testInfo.attach(name, { path: filePath, contentType: 'image/png' });
};

export const allowWarnings = (testInfo: TestInfo, reason?: string) => {
  testInfo.annotations.push({ type: 'allow-warnings', description: reason ?? 'Expected warning or error UI.' });
};

export const startStrictUiMonitoring = async (page: Page, testInfo: TestInfo) => {
  if (getTracker(testInfo)) return;

  const tracker: StrictUiTracker = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    toastIssues: [],
    detach: () => {},
  };

  await page.exposeFunction('__pwRecordToastIssue', (issue: ToastIssue) => {
    const message = `${issue.type}: ${issue.message}`.trim();
    tracker.toastIssues.push(message);
  });

  await page.addInitScript(() => {
    const record = (type: string, message: string) => {
      const hook = (window as Window & { __pwRecordToastIssue?: (issue: { type: string; message: string }) => void })
        .__pwRecordToastIssue;
      if (hook) {
        hook({ type, message });
      }
    };

    const selectors = [
      '[data-sonner-toast][data-type="error"]',
      '[data-sonner-toast][data-type="warning"]',
      '[data-state="open"].destructive',
    ];

    const checkElement = (element: Element) => {
      selectors.forEach((selector) => {
        if (element.matches(selector)) {
          record('toast', element.textContent?.trim() || selector);
        }
        const found = element.querySelector(selector);
        if (found) {
          record('toast', found.textContent?.trim() || selector);
        }
      });
    };

    const startObserver = () => {
      const root = document.documentElement;
      if (!root) return;

      selectors.forEach((selector) => {
        root.querySelectorAll(selector).forEach((element) => checkElement(element));
      });

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              checkElement(node);
            }
          });
        });
      });

      observer.observe(root, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
      startObserver();
    }
  });

  const onConsole = (msg: { type: () => string; text: () => string }) => {
    const type = msg.type();
    if (type === 'warning' || type === 'warn') {
      tracker.consoleWarnings.push(msg.text());
    }
    if (type === 'error') {
      tracker.consoleErrors.push(msg.text());
    }
  };

  const onPageError = (error: Error) => {
    tracker.pageErrors.push(error.message || String(error));
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  tracker.detach = () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  };

  setTracker(testInfo, tracker);
};

export const assertNoUiIssues = async (page: Page, testInfo: TestInfo) => {
  const tracker = getTracker(testInfo);
  if (!tracker) return;
  if (testInfo.annotations.some((annotation) => annotation.type === 'allow-warnings')) return;

  const activeToastTexts = await page
    .locator('[data-sonner-toast][data-type="error"], [data-sonner-toast][data-type="warning"], [data-state="open"].destructive')
    .allTextContents();
  activeToastTexts
    .map((text) => text.trim())
    .filter(Boolean)
    .forEach((text) => tracker.toastIssues.push(`toast: ${text}`));

  const issues = [
    ...tracker.consoleWarnings.map((message) => `console warning: ${message}`),
    ...tracker.consoleErrors.map((message) => `console error: ${message}`),
    ...tracker.pageErrors.map((message) => `page error: ${message}`),
    ...tracker.toastIssues.map((message) => `ui issue: ${message}`),
  ];

  tracker.detach();

  if (issues.length) {
    throw new Error(`Unexpected warnings/errors during test:\n${issues.join('\n')}`);
  }
};
