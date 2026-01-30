import type { Page, TestInfo } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type TraceEvent = {
  id: string;
  timestamp: string;
  relativeMs: number;
  type: string;
  origin: string;
  correlationId: string;
  data: Record<string, unknown>;
};

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

const getEvidenceDir = (testInfo: TestInfo) => {
  const testId = generateTestId(testInfo);
  const deviceId = testInfo.project.name;
  return path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright', testId, deviceId);
};

export const clearTraces = async (page: Page) => {
  await page.evaluate(() => {
    const tracing = (window as Window & { __c64uTracing?: { clearTraces?: () => void } }).__c64uTracing;
    tracing?.clearTraces?.();
  });
};

export const getTraces = async (page: Page): Promise<TraceEvent[]> => {
  return await page.evaluate(() => {
    const tracing = (window as Window & { __c64uTracing?: { getTraces?: () => TraceEvent[] } }).__c64uTracing;
    return tracing?.getTraces?.() ?? [];
  });
};

export const exportTracesZip = async (page: Page): Promise<Uint8Array | null> => {
  const data = await page.evaluate(() => {
    const tracing = (window as Window & { __c64uTracing?: { exportTraces?: () => Uint8Array } }).__c64uTracing;
    const payload = tracing?.exportTraces?.();
    return payload ? Array.from(payload) : null;
  });
  return data ? Uint8Array.from(data) : null;
};

export const saveTracesFromPage = async (page: Page, testInfo: TestInfo) => {
  const evidenceDir = getEvidenceDir(testInfo);
  await fs.mkdir(evidenceDir, { recursive: true });
  const traces = await getTraces(page);
  await fs.writeFile(path.join(evidenceDir, 'trace.json'), JSON.stringify(traces, null, 2), 'utf8');
  const zip = await exportTracesZip(page);
  if (zip) {
    await fs.writeFile(path.join(evidenceDir, 'trace-app.zip'), Buffer.from(zip));
  }

  if (process.env.RECORD_TRACES === '1') {
    const outputDir = process.env.TRACE_OUTPUT_DIR || path.resolve(process.cwd(), 'test-results', 'traces', 'golden');
    const suite = process.env.TRACE_SUITE ? sanitizeSegment(process.env.TRACE_SUITE) : null;
    const suiteDir = suite ? path.join(outputDir, suite) : outputDir;
    const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright');
    const relative = path.relative(evidenceRoot, evidenceDir);
    const goldenDir = path.join(suiteDir, relative);
    await fs.mkdir(goldenDir, { recursive: true });
    await fs.writeFile(path.join(goldenDir, 'trace.json'), JSON.stringify(traces, null, 2), 'utf8');
    const metaSource = path.join(evidenceDir, 'meta.json');
    try {
      await fs.copyFile(metaSource, path.join(goldenDir, 'meta.json'));
    } catch {
      // meta.json will be generated later in finalizeEvidence; skip if missing.
    }
  }
};

export const assertTraceOrder = (events: TraceEvent[], expectedTypes: string[]) => {
  const actual = events.map((event) => event.type);
  const strictMode = process.env.TRACE_STRICT === '1';
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
