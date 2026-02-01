import type { Page, TestInfo } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateViewport, enforceVisualBoundaries } from './viewportValidation';
import { getTraceAssertionConfig, getTraces, saveTracesFromPage } from './traceUtils';
import {
  compareTraceFiles,
  compareOrPromoteTraceFiles,
  formatTraceErrors,
  resolveGoldenDirForEvidence,
} from './traceComparison.js';
import { createEvidenceMetadata } from './evidenceConsolidation';

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

const generateTestId = (testInfo: TestInfo): string => {
  const fileName = path.basename(testInfo.file, '.ts').replace(/\.spec$/, '');
  const titlePath = getTitlePath(testInfo);
  
  const parts = [fileName, ...titlePath].map((part) =>
    part
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]+/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  ).filter(Boolean);
  
  return parts.join('--');
};

const getEvidenceDir = (testInfo: TestInfo) => {
  const testId = generateTestId(testInfo);
  const deviceId = testInfo.project.name;
  return path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright', testId, deviceId);
};

type TraceEvent = {
  id: string;
  timestamp: string;
  relativeMs: number;
  type: string;
  origin: string;
  correlationId: string;
  data: Record<string, unknown>;
};

type StrictUiTracker = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  toastIssues: string[];
  horizontalOverflows: string[];
  requestLog: Array<{ method: string; url: string; resourceType: string }>
  routingIssues: string[];
  traceResetAt?: number;
  /** Traces accumulated across page navigations */
  accumulatedTraces: TraceEvent[];
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
  const safe = sanitizeLabel(label);
  const step = String(getStepIndex(testInfo)).padStart(2, '0');
  const name = safe.length ? `${step}-${safe}.png` : `${step}-step.png`;
  const evidenceDir = getEvidenceDir(testInfo);
  const screenshotsDir = path.join(evidenceDir, 'screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  const filePath = path.join(screenshotsDir, name);
  await page.screenshot({ path: filePath, fullPage: true });
  
  // Note: We no longer call testInfo.attach() to avoid creating duplicate evidence
  // in Playwright's outputDir. All evidence is now in the canonical structure:
  // test-results/evidence/playwright/<testId>/<deviceId>/

  // Enforce visual boundaries after capturing screenshot (unless explicitly allowed)
  const allowOverflow = testInfo.annotations.some((a) => a.type === 'allow-visual-overflow');
  if (!allowOverflow) {
    await enforceVisualBoundaries(page, testInfo);
  }
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

const hasPendingRestRequests = (traces: Awaited<ReturnType<typeof getTraces>>) => {
  const byCorrelation = new Map<string, Array<{ event: (typeof traces)[number]; index: number }>>();
  traces.forEach((event, index) => {
    const list = byCorrelation.get(event.correlationId) ?? [];
    list.push({ event, index });
    byCorrelation.set(event.correlationId, list);
  });

  const findIndex = (
    events: Array<{ event: (typeof traces)[number]; index: number }>,
    type: string,
    after?: number,
  ) => {
    const filtered = events.filter((entry) => entry.event.type === type && (after === undefined || entry.index > after));
    return filtered.length ? filtered[0].index : null;
  };

  return traces.some((event, index) => {
    if (event.type !== 'rest-request') return false;
    const related = byCorrelation.get(event.correlationId) ?? [];
    const responseIndex = findIndex(related, 'rest-response', index);
    return responseIndex === null;
  });
};

const waitForTraceStability = async (page: Page, attempts = 3, delayMs = 50) => {
  let traces = await getTraces(page);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.waitForTimeout(delayMs);
    const next = await getTraces(page);
    if (next.length === traces.length) {
      return next;
    }
    traces = next;
  }
  return traces;
};

export const finalizeEvidence = async (page: Page, testInfo: TestInfo) => {
  const evidenceDir = getEvidenceDir(testInfo);
  await fs.mkdir(evidenceDir, { recursive: true });

  const tracker = getTracker(testInfo);
  let requestLogSnapshot: StrictUiTracker['requestLog'] = tracker?.requestLog ? [...tracker.requestLog] : [];

  if (getStepCount(testInfo) === 0 && !page.isClosed()) {
    await attachStepScreenshot(page, testInfo, 'final-state');
  }

  await writeErrorContext(testInfo, evidenceDir);

  const viewport = page.viewportSize ? page.viewportSize() : null;
  await createEvidenceMetadata(testInfo, viewport);

  let traces: Awaited<ReturnType<typeof getTraces>> = [];
  if (!page.isClosed()) {
    traces = await waitForTraceStability(page);
    if (hasPendingRestRequests(traces)) {
      traces = await waitForTraceStability(page, 12, 250);
    }
    if (tracker?.requestLog) {
      requestLogSnapshot = [...tracker.requestLog];
    }

    await saveTracesFromPage(page, testInfo, traces).catch(() => {});
  }

  if (requestLogSnapshot.length) {
    await fs.writeFile(
      path.join(evidenceDir, 'request-routing.json'),
      JSON.stringify(requestLogSnapshot, null, 2),
      'utf8',
    );
  }

  const goldenDir = resolveGoldenDirForEvidence(evidenceDir);
  try {
    const result = await compareOrPromoteTraceFiles(goldenDir, evidenceDir);
    if (result.promoted) {
      const relativeGolden = path.relative(process.cwd(), goldenDir);
      // eslint-disable-next-line no-console
      console.warn(`Promoted missing golden trace: ${relativeGolden}`);
    }
    if (result.errors.length) {
      const relativeGolden = path.relative(process.cwd(), goldenDir);
      throw new Error(formatTraceErrors(result.errors, relativeGolden));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Trace comparison failed: ${message}`);
  }

  const traceConfig = getTraceAssertionConfig(testInfo);
  if (traceConfig.enabled && !page.isClosed()) {
    const tracker = getTracker(testInfo);
    if (!tracker) {
      throw new Error('Trace assertions enabled but strict UI monitoring was not started.');
    }
    const requestLog = requestLogSnapshot;
    // Trace coverage validation is opt-in only. Enable with TRACE_ASSERTIONS_STRICT=1.
    // This validation ensures all REST requests are represented in traces.
    if (process.env.TRACE_ASSERTIONS_STRICT === '1') {
      const normalizeUrl = (value: string) => {
        try {
          const parsed = new URL(value);
          return `${parsed.pathname}${parsed.search}`;
        } catch {
          return value.replace(/https?:\/\/[^/]+/i, '');
        }
      };
      const requestCounts = new Map<string, number>();
      let ftpRequestCount = 0;
      requestLog.forEach((entry) => {
        const normalized = normalizeUrl(entry.url);
        if (normalized.includes('/v1/ftp/list')) {
          ftpRequestCount += 1;
        }
        const key = `${entry.method.toUpperCase()} ${normalized}`;
        requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
      });

      const traceCounts = new Map<string, number>();
      traces
        .filter((event) => event.type === 'rest-request')
        .forEach((event) => {
          const data = event.data as { method?: string; normalizedUrl?: string; url?: string };
          const method = typeof data.method === 'string' ? data.method.toUpperCase() : 'GET';
          const url = typeof data.normalizedUrl === 'string'
            ? data.normalizedUrl
            : typeof data.url === 'string'
              ? normalizeUrl(data.url)
              : '';
          const key = `${method} ${url}`;
          traceCounts.set(key, (traceCounts.get(key) ?? 0) + 1);
        });

      const missing: string[] = [];
      requestCounts.forEach((count, key) => {
        const traced = traceCounts.get(key) ?? 0;
        if (traced === 0) {
          missing.push(`${key} (requests=${count}, traces=${traced})`);
        }
      });
      if (ftpRequestCount > 0) {
        const ftpTraceCount = traces.filter((event) => event.type === 'ftp-operation').length;
        if (ftpTraceCount === 0) {
          missing.push(`FTP list operations (requests=${ftpRequestCount}, traces=${ftpTraceCount})`);
        }
      }
      if (missing.length) {
        throw new Error(`Trace coverage missing for REST requests:\n${missing.join('\n')}`);
      }
    }

    // Trace sequence validation is opt-in only. Enable with TRACE_ASSERTIONS_STRICT=1.
    // This validation ensures every traced operation has complete event sequences.
    if (process.env.TRACE_ASSERTIONS_STRICT === '1') {
      const eventsByCorrelation = new Map<string, Array<{ event: (typeof traces)[number]; index: number }>>();
      traces.forEach((event, index) => {
        const list = eventsByCorrelation.get(event.correlationId) ?? [];
        list.push({ event, index });
        eventsByCorrelation.set(event.correlationId, list);
      });

      const findIndex = (events: Array<{ event: (typeof traces)[number]; index: number }>, type: string, after?: number) => {
        const filtered = events.filter((entry) => entry.event.type === type && (after === undefined || entry.index > after));
        return filtered.length ? filtered[0].index : null;
      };

      traces.forEach((event, index) => {
        if (event.type !== 'rest-request' && event.type !== 'ftp-operation') return;
        const related = eventsByCorrelation.get(event.correlationId) ?? [];
        const startIndex = findIndex(related, 'action-start');
        const decisionIndex = findIndex(related, 'backend-decision');
        const endIndex = findIndex(related, 'action-end', index);
        if (startIndex === null || decisionIndex === null || endIndex === null) {
          throw new Error(`Trace sequence incomplete for correlation ${event.correlationId}.`);
        }
        if (event.type === 'rest-request') {
          const responseIndex = findIndex(related, 'rest-response', index);
          if (responseIndex === null) {
            throw new Error(`Missing rest-response for correlation ${event.correlationId}.`);
          }
        }
      });
    }
  }

  

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

  // Evidence metadata already captured above.
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
    requestLog: [],
    routingIssues: [],
    traceResetAt: undefined,
    accumulatedTraces: [],
    detach: () => {},
  };

  const recordRequest = (request: {
    method: () => string;
    url: () => string;
    resourceType: () => string;
    isNavigationRequest?: () => boolean;
    frame?: () => { url: () => string } | null;
  }) => {
    const isNavigation = typeof request.isNavigationRequest === 'function' && request.isNavigationRequest();
    const isMainFrame = typeof request.frame === 'function' && request.frame() === page.mainFrame();
    if (isNavigation && isMainFrame) {
      tracker.requestLog = [];
      tracker.traceResetAt = Date.now();
    }
    const url = request.url();
    if (!url.includes('/v1/')) return;
    if (request.method().toUpperCase() === 'OPTIONS') return;
    tracker.requestLog.push({
      method: request.method(),
      url,
      resourceType: request.resourceType(),
    });
  };

  page.on('request', recordRequest);

  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    tracker.requestLog = [];
    tracker.traceResetAt = Date.now();
  });

  try {
    await page.exposeFunction('__pwTraceReset', () => {
      tracker.requestLog = [];
      tracker.traceResetAt = Date.now();
    });
  } catch {
    // Ignore if already registered for this page.
  }

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
    page.off('request', recordRequest);
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
    const isToastElement = (element: Element) =>
      Boolean(
        element.closest(
          '[data-sonner-toast], [data-sonner-toaster], .toaster, .toast, [role="status"], [data-state="open"].destructive'
        )
      );

    elements.forEach((element) => {
      if (isToastElement(element)) return;
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

  const routingConfig = await page.evaluate(() => {
    const win = window as Window & {
      __c64uExpectedBaseUrl?: string;
      __c64uAllowedBaseUrls?: string[];
      __c64uMockServerBaseUrl?: string;
    };
    return {
      expectedBaseUrl: win.__c64uExpectedBaseUrl ?? null,
      allowedBaseUrls: Array.isArray(win.__c64uAllowedBaseUrls) ? win.__c64uAllowedBaseUrls : null,
      demoBaseUrl: win.__c64uMockServerBaseUrl ?? null,
    };
  });
  const allowedBaseUrls = routingConfig.allowedBaseUrls
    ?? (routingConfig.expectedBaseUrl ? [routingConfig.expectedBaseUrl] : []);

  if (allowedBaseUrls.length) {
    tracker.requestLog.forEach((entry) => {
      const isAllowed = allowedBaseUrls.some((baseUrl) => entry.url.startsWith(baseUrl));
      if (!isAllowed) {
        tracker.routingIssues.push(`request routed to unexpected backend: ${entry.method} ${entry.url}`);
      }
    });
  } else if (tracker.requestLog.length) {
    tracker.routingIssues.push('routing expectations not configured for backend requests');
  }

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
    ...tracker.routingIssues.map((message) => `routing issue: ${message}`),
  ];

  tracker.detach();

  if (issues.length) {
    throw new Error(`Unexpected warnings/errors during test:\n${issues.join('\n')}`);
  }
};
