import type { Page, TestInfo } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateViewport, enforceVisualBoundaries } from './viewportValidation';
import { createEvidenceMetadata, consolidateEvidence, getCanonicalEvidencePath } from './evidenceConsolidation';

const sanitizeLabel = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]+/g, '');

const sanitizeSegment = (value: string) => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'untitled';
};

const getTitlePath = (testInfo: TestInfo) => {
  if (typeof (testInfo as TestInfo & { titlePath?: () => string[] }).titlePath === 'function') {
    return (testInfo as TestInfo & { titlePath: () => string[] }).titlePath();
  }
  return (testInfo as TestInfo & { titlePath?: string[] }).titlePath ?? [testInfo.title];
};

const getEvidenceDirName = (testInfo: TestInfo) => {
  const titlePath = getTitlePath(testInfo);
  const describeParts = titlePath.slice(0, -1).map(sanitizeSegment).filter(Boolean);
  const testPart = sanitizeSegment(titlePath[titlePath.length - 1] ?? testInfo.title);
  const describeSlug = describeParts.length ? describeParts.join('--') : 'root';
  const projectPrefix = testInfo.project.name ? `${testInfo.project.name}__` : '';
  return `${projectPrefix}${describeSlug}--${testPart}`;
};

const getEvidenceDir = (testInfo: TestInfo) =>
  path.resolve(process.cwd(), 'test-results', 'evidence', getEvidenceDirName(testInfo));

type StrictUiTracker = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  toastIssues: string[];
  horizontalOverflows: string[];
  detach: () => void;
};

type ToastIssue = { type: string; message: string };

const getStepIndex = (testInfo: TestInfo) => {
  const info = testInfo as TestInfo & { __stepIndex?: number };
  info.__stepIndex = (info.__stepIndex ?? 0) + 1;
  return info.__stepIndex;
};

const getStepCount = (testInfo: TestInfo) => (testInfo as TestInfo & { __stepIndex?: number }).__stepIndex ?? 0;

const getTracker = (testInfo: TestInfo) =>
  (testInfo as TestInfo & { __strictUiTracker?: StrictUiTracker }).__strictUiTracker;

const setTracker = (testInfo: TestInfo, tracker: StrictUiTracker) => {
  (testInfo as TestInfo & { __strictUiTracker?: StrictUiTracker }).__strictUiTracker = tracker;
};

export const attachStepScreenshot = async (page: Page, testInfo: TestInfo, label: string) => {
  // Enforce visual boundaries before taking screenshot (unless explicitly allowed)
  const allowOverflow = testInfo.annotations.some((a) => a.type === 'allow-visual-overflow');
  if (!allowOverflow) {
    await enforceVisualBoundaries(page, testInfo);
  }
  
  const safe = sanitizeLabel(label);
  const step = String(getStepIndex(testInfo)).padStart(2, '0');
  const name = safe.length ? `${step}-${safe}.png` : `${step}-step.png`;
  const evidenceDir = getEvidenceDir(testInfo);
  await fs.mkdir(evidenceDir, { recursive: true });
  const filePath = path.join(evidenceDir, name);
  await page.screenshot({ path: filePath, fullPage: true });
  await testInfo.attach(name, { path: filePath, contentType: 'image/png' });
};

const copyIfExists = async (source: string, destination: string) => {
  try {
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size === 0) return false;
    await fs.copyFile(source, destination);
    return true;
  } catch {
    return false;
  }
};

const writeErrorContext = async (testInfo: TestInfo, evidenceDir: string) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const errors = testInfo.errors ?? [];
  const payload = [
    `Status: ${testInfo.status}`,
    `Expected: ${testInfo.expectedStatus}`,
    `Retry: ${testInfo.retry}`,
    `Project: ${testInfo.project.name}`,
    '',
    'Errors:',
    ...errors.map((error, index) => {
      const message = error.message || String(error);
      const stack = error.stack ? `\n${error.stack}` : '';
      return `#${index + 1}: ${message}${stack}`;
    }),
  ].join('\n');
  await fs.writeFile(path.join(evidenceDir, 'error-context.md'), payload, 'utf8');
};

export const finalizeEvidence = async (page: Page, testInfo: TestInfo) => {
  const evidenceDir = getEvidenceDir(testInfo);
  await fs.mkdir(evidenceDir, { recursive: true });

  if (getStepCount(testInfo) === 0 && !page.isClosed()) {
    await attachStepScreenshot(page, testInfo, 'final-state');
  }

  await writeErrorContext(testInfo, evidenceDir);

  const tracePath = testInfo.outputPath('trace.zip');
  await copyIfExists(tracePath, path.join(evidenceDir, 'trace.zip'));

  const video = page.video();
  if (!page.isClosed()) {
    await page.close();
  }
  const expectedVideo = path.join(evidenceDir, 'video.webm');
  if (video) {
    try {
      await video.path();
      await video.saveAs(expectedVideo);
    } catch {
      // Fall through to outputPath fallback below.
    }
  }

  const videoPath = testInfo.outputPath('video.webm');
  await copyIfExists(videoPath, expectedVideo);

  // Create canonical evidence structure
  const viewport = page.viewportSize ? page.viewportSize() : null;
  await createEvidenceMetadata(testInfo, viewport);
  await consolidateEvidence(testInfo, evidenceDir);
};

export const allowWarnings = (testInfo: TestInfo, reason?: string) => {
  testInfo.annotations.push({ type: 'allow-warnings', description: reason ?? 'Expected warning or error UI.' });
};

export const allowVisualOverflow = (testInfo: TestInfo, reason: string) => {
  testInfo.annotations.push({ type: 'allow-visual-overflow', description: reason });
};

export const startStrictUiMonitoring = async (page: Page, testInfo: TestInfo) => {
  if (getTracker(testInfo)) return;

  // Validate viewport configuration immediately
  await validateViewport(page, testInfo);

  const tracker: StrictUiTracker = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    toastIssues: [],
    horizontalOverflows: [],
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

const checkHorizontalOverflow = async (page: Page, testInfo: TestInfo) => {
  const tracker = getTracker(testInfo);
  if (!tracker) return;

  // Skip overflow checks if test allows visual overflow
  if (testInfo.annotations.some((a) => a.type === 'allow-visual-overflow')) return;

  const viewportWidth = page.viewportSize()?.width;
  if (!viewportWidth) return;

  const SUBPIXEL_TOLERANCE = 3; // Match viewportValidation.ts tolerance
  const overflows = await page.evaluate((config) => {
    const results: string[] = [];
    const elements = document.querySelectorAll('body *');

    elements.forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width > config.maxWidth + config.tolerance || rect.right > config.maxWidth + config.tolerance) {
        const tag = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const classes = element.className
          ? `.${String(element.className).replace(/\s+/g, '.')}`
          : '';
        const selector = `${tag}${id}${classes}`.slice(0, 100);
        results.push(`${selector} (width: ${rect.width}px, right: ${rect.right}px, viewport: ${config.maxWidth}px)`);
      }
    });

    return results;
  }, { maxWidth: viewportWidth, tolerance: SUBPIXEL_TOLERANCE });

  overflows.forEach((overflow) => tracker.horizontalOverflows.push(overflow));
};

export const assertNoUiIssues = async (page: Page, testInfo: TestInfo) => {
  const tracker = getTracker(testInfo);
  if (!tracker) return;
  if (testInfo.annotations.some((annotation) => annotation.type === 'allow-warnings')) return;

  // Check for horizontal overflow before other checks
  // Note: We don't call enforceVisualBoundaries here because it throws immediately.
  // Instead, we use checkHorizontalOverflow which accumulates issues and reports them all.
  await checkHorizontalOverflow(page, testInfo);

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
    ...tracker.horizontalOverflows.map((message) => `horizontal overflow: ${message}`),
  ];

  tracker.detach();

  if (issues.length) {
    throw new Error(`Unexpected warnings/errors during test:\n${issues.join('\n')}`);
  }
};
