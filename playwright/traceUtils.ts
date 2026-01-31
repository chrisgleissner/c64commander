import { expect, type Page, type TestInfo } from '@playwright/test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

type TraceEvent = {
  id: string;
  timestamp: string;
  relativeMs: number;
  type: string;
  origin: string;
  correlationId: string;
  data: Record<string, unknown>;
};

type TraceAssertionConfig = {
  enabled: boolean;
  strict: boolean;
  defaultEnabled: boolean;
};

type TraceAssertionOptions = {
  strict?: boolean;
  reason?: string;
};

const TRACE_ASSERT_ANNOTATION = 'trace-assert';
const TRACE_ASSERT_OFF_ANNOTATION = 'trace-assert-off';
const TRACE_STRICT_ANNOTATION = 'trace-strict';
const TRACE_NON_STRICT_ANNOTATION = 'trace-non-strict';
const DEFAULT_SEQUENCE = ['action-start', 'backend-decision', 'rest-request', 'rest-response', 'action-end'];
const DEFAULT_FTP_SEQUENCE = ['action-start', 'backend-decision', 'ftp-operation', 'action-end'];

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

  const parts = [fileName, ...titlePath]
    .map((part) =>
      part
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    )
    .filter(Boolean);

  return parts.join('--');
};

const isAnnotationPresent = (testInfo: TestInfo, type: string) =>
  testInfo.annotations.some((annotation: TestInfo['annotations'][number]) => annotation.type === type);

export const getTraceAssertionConfig = (testInfo: TestInfo): TraceAssertionConfig => {
  const defaultEnabled = process.env.TRACE_ASSERTIONS_DEFAULT === '1';
  const optedIn = isAnnotationPresent(testInfo, TRACE_ASSERT_ANNOTATION);
  const optedOut = isAnnotationPresent(testInfo, TRACE_ASSERT_OFF_ANNOTATION);
  if (optedIn && optedOut) {
    throw new Error(`Trace assertions cannot be both enabled and disabled for "${testInfo.title}".`);
  }
  const strictOverride = isAnnotationPresent(testInfo, TRACE_NON_STRICT_ANNOTATION)
    ? false
    : isAnnotationPresent(testInfo, TRACE_STRICT_ANNOTATION)
      ? true
      : undefined;
  const strictEnv = process.env.TRACE_STRICT === '1';
  return {
    enabled: optedOut ? false : optedIn || defaultEnabled,
    strict: strictOverride ?? strictEnv,
    defaultEnabled,
  };
};

const assertTraceOptIn = (testInfo: TestInfo, context: string): TraceAssertionConfig => {
  const config = getTraceAssertionConfig(testInfo);
  if (!config.enabled) {
    throw new Error(
      `Trace assertions not enabled for "${testInfo.title}" (${context}). `
        + `Call enableTraceAssertions(testInfo, ...) or set TRACE_ASSERTIONS_DEFAULT=1.`,
    );
  }
  return config;
};

const getNormalizedUrl = (event: TraceEvent): string => {
  const data = event.data as { normalizedUrl?: unknown; url?: unknown };
  if (typeof data?.normalizedUrl === 'string') return data.normalizedUrl;
  if (typeof data?.url === 'string') return data.url;
  return '';
};

export const enableTraceAssertions = (testInfo: TestInfo, options: TraceAssertionOptions = {}) => {
  const description = options.reason ?? 'Trace assertions enabled';
  testInfo.annotations.push({ type: TRACE_ASSERT_ANNOTATION, description });
  if (options.strict === true) {
    testInfo.annotations.push({ type: TRACE_STRICT_ANNOTATION, description: 'Strict trace ordering enabled' });
  }
  if (options.strict === false) {
    testInfo.annotations.push({ type: TRACE_NON_STRICT_ANNOTATION, description: 'Strict trace ordering disabled' });
  }
};

export const disableTraceAssertions = (testInfo: TestInfo, reason: string) => {
  testInfo.annotations.push({ type: TRACE_ASSERT_OFF_ANNOTATION, description: reason });
};

const getEvidenceDir = (testInfo: TestInfo) => {
  const testId = generateTestId(testInfo);
  const deviceId = testInfo.project.name;
  return path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright', testId, deviceId);
};

export const clearTraces = async (page: Page) => {
  await page.evaluate(() => {
    const tracing = (window as Window & {
      __c64uTracing?: {
        clearTraces?: () => void;
        resetTraceIds?: (eventStart?: number, correlationStart?: number) => void;
        resetTraceSession?: (eventStart?: number, correlationStart?: number) => void;
      }
      __pwTraceReset?: () => void;
    }).__c64uTracing;
    if (tracing?.resetTraceSession) {
      tracing.resetTraceSession(0, 0);
      (window as Window & { __pwTraceReset?: () => void }).__pwTraceReset?.();
      return;
    }
    tracing?.clearTraces?.();
    tracing?.resetTraceIds?.(0, 0);
    (window as Window & { __pwTraceReset?: () => void }).__pwTraceReset?.();
  });
};

export const getTraces = async (page: Page): Promise<TraceEvent[]> => {
  return await page.evaluate(() => {
    const tracing = (window as Window & { __c64uTracing?: { getTraces?: () => TraceEvent[] } }).__c64uTracing;
    return tracing?.getTraces?.() ?? [];
  });
};

export const saveTracesFromPage = async (page: Page, testInfo: TestInfo, tracesOverride?: TraceEvent[]) => {
  const evidenceDir = getEvidenceDir(testInfo);
  await fs.mkdir(evidenceDir, { recursive: true });
  const traces = tracesOverride ?? await getTraces(page);
  await fs.writeFile(path.join(evidenceDir, 'trace.json'), JSON.stringify(traces, null, 2), 'utf8');

  if (process.env.RECORD_TRACES === '1') {
    const outputDir = process.env.TRACE_OUTPUT_DIR
      || path.resolve(process.cwd(), 'playwright', 'fixtures', 'traces', 'golden');
    const suite = process.env.TRACE_SUITE ? sanitizeSegment(process.env.TRACE_SUITE) : null;
    const suiteDir = suite ? path.join(outputDir, suite) : outputDir;
    const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright');
    const relative = path.relative(evidenceRoot, evidenceDir);
    const goldenDir = path.join(suiteDir, relative);
    await fs.mkdir(goldenDir, { recursive: true });
    await fs.writeFile(path.join(goldenDir, 'trace.json'), JSON.stringify(traces, null, 2), 'utf8');
  }
};

export const assertTraceOrder = (testInfo: TestInfo, events: TraceEvent[], expectedTypes: string[] = DEFAULT_SEQUENCE) => {
  const config = assertTraceOptIn(testInfo, 'assertTraceOrder');
  const actual = events.map((event) => event.type);
  const strictMode = config.strict;
  let cursor = 0;
  expectedTypes.forEach((expected) => {
    const idx = actual.indexOf(expected, cursor);
    if (idx === -1) {
      throw new Error(`Expected trace event type not found: ${expected}`);
    }
    cursor = idx + 1;
  });
  if (strictMode) {
    const expectedSequence = expectedTypes.join('>');
    const actualSequence = actual.join('>');
    if (actualSequence !== expectedSequence) {
      throw new Error(`Strict trace ordering mismatch. Expected: ${expectedSequence} Actual: ${actualSequence}`);
    }
  }
};

export const findTraceEvent = (events: TraceEvent[], type: string, predicate?: (event: TraceEvent) => boolean) => {
  return events.find((event) => event.type === type && (!predicate || predicate(event)));
};

export const findRestRequest = (events: TraceEvent[], matcher: string | RegExp) =>
  findTraceEvent(events, 'rest-request', (event) => {
    const url = getNormalizedUrl(event);
    return typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url);
  });

export const findFtpOperation = (events: TraceEvent[], predicate?: (event: TraceEvent) => boolean) =>
  findTraceEvent(events, 'ftp-operation', predicate);

export const assertRestTraceSequence = (
  testInfo: TestInfo,
  events: TraceEvent[],
  matcher: string | RegExp,
  expectedTypes: string[] = DEFAULT_SEQUENCE,
) => {
  assertTraceOptIn(testInfo, 'assertRestTraceSequence');
  const requestEvent = findRestRequest(events, matcher);
  if (!requestEvent) {
    throw new Error(`Expected rest-request trace not found for matcher: ${String(matcher)}`);
  }
  const related = events.filter((event) => event.correlationId === requestEvent.correlationId);
  assertTraceOrder(testInfo, related, expectedTypes);
  return { requestEvent, related };
};

export const assertFtpTraceSequence = (
  testInfo: TestInfo,
  events: TraceEvent[],
  predicate?: (event: TraceEvent) => boolean,
  expectedTypes: string[] = DEFAULT_FTP_SEQUENCE,
) => {
  assertTraceOptIn(testInfo, 'assertFtpTraceSequence');
  const ftpEvent = findFtpOperation(events, predicate);
  if (!ftpEvent) {
    throw new Error('Expected ftp-operation trace not found.');
  }
  const related = events.filter((event) => event.correlationId === ftpEvent.correlationId);
  assertTraceOrder(testInfo, related, expectedTypes);
  return { ftpEvent, related };
};

export const expectRestTraceSequence = async (
  page: Page,
  testInfo: TestInfo,
  matcher: string | RegExp,
  expectedTypes: string[] = DEFAULT_SEQUENCE,
) => {
  await expect.poll(async () => {
    const traces = await getTraces(page);
    try {
      assertRestTraceSequence(testInfo, traces, matcher, expectedTypes);
      return true;
    } catch {
      return false;
    }
  }).toBe(true);

  const traces = await getTraces(page);
  return assertRestTraceSequence(testInfo, traces, matcher, expectedTypes);
};

export const expectFtpTraceSequence = async (
  page: Page,
  testInfo: TestInfo,
  predicate?: (event: TraceEvent) => boolean,
  expectedTypes: string[] = DEFAULT_FTP_SEQUENCE,
) => {
  if (process.env.VITE_COVERAGE === '1' || process.env.VITE_COVERAGE === 'true') {
    return;
  }
  await expect.poll(async () => {
    const traces = await getTraces(page);
    try {
      assertFtpTraceSequence(testInfo, traces, predicate, expectedTypes);
      return true;
    } catch {
      return false;
    }
  }).toBe(true);

  const traces = await getTraces(page);
  return assertFtpTraceSequence(testInfo, traces, predicate, expectedTypes);
};
