#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright');
const goldenRoot = path.resolve(process.env.TRACE_GOLDEN_DIR || path.join(process.cwd(), 'test-results', 'traces', 'golden'));

const errors = [];

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeUrl = (value) => {
  if (!value || typeof value !== 'string') return value;
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value.replace(/https?:\/\/[^/]+/i, '');
  }
};

const normalizeHeaders = (headers) => {
  if (!headers || typeof headers !== 'object') return headers;
  const normalized = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (/host/i.test(key)) {
      normalized[key] = '***';
      return;
    }
    normalized[key] = value;
  });
  return normalized;
};

const normalizeTrace = (events) => {
  const correlationMap = new Map();
  let corrIndex = 0;
  return events.map((event) => {
    const normalized = { ...event };
    if (!isUuid(normalized.correlationId)) {
      errors.push(`Invalid correlationId: ${normalized.correlationId}`);
    }
    if (!correlationMap.has(normalized.correlationId)) {
      corrIndex += 1;
      correlationMap.set(normalized.correlationId, `corr-${corrIndex}`);
    }
    normalized.correlationId = correlationMap.get(normalized.correlationId);
    delete normalized.id;
    delete normalized.timestamp;
    normalized.relativeMs = 0;
    if (normalized.data && typeof normalized.data === 'object') {
      const data = { ...normalized.data };
      if (typeof data.url === 'string') data.url = normalizeUrl(data.url);
      if (typeof data.normalizedUrl === 'string') data.normalizedUrl = normalizeUrl(data.normalizedUrl);
      if (data.headers) data.headers = normalizeHeaders(data.headers);
      normalized.data = data;
    }
    return normalized;
  });
};

const listDirs = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
};

const readTraceJson = async (dir) => {
  const filePath = path.join(dir, 'trace.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const compareTraceFiles = async (goldenDir, evidenceDir) => {
  const goldenTrace = await readTraceJson(goldenDir);
  const evidenceTrace = await readTraceJson(evidenceDir);

  const normalizedGolden = normalizeTrace(goldenTrace);
  const normalizedEvidence = normalizeTrace(evidenceTrace);

  const goldenString = JSON.stringify(normalizedGolden, null, 2);
  const evidenceString = JSON.stringify(normalizedEvidence, null, 2);

  if (goldenString !== evidenceString) {
    errors.push(`Trace mismatch for ${path.relative(goldenRoot, goldenDir)}`);
  }
};

const main = async () => {
  const goldenStat = await fs.stat(goldenRoot).catch(() => null);
  if (!goldenStat || !goldenStat.isDirectory()) {
    errors.push(`Golden trace directory missing: ${goldenRoot}`);
  }

  const goldenSuites = await listDirs(goldenRoot);
  if (goldenSuites.length === 0) {
    errors.push(`Golden trace directory empty: ${goldenRoot}`);
  }

  for (const suitePath of goldenSuites) {
    const suiteEntries = await listDirs(suitePath);
    for (const goldenDir of suiteEntries) {
      const relative = path.relative(goldenRoot, goldenDir);
      const evidenceDir = path.join(evidenceRoot, relative);
      const evidenceStat = await fs.stat(evidenceDir).catch(() => null);
      if (!evidenceStat || !evidenceStat.isDirectory()) {
        errors.push(`Missing evidence traces for ${relative}`);
        continue;
      }
      await compareTraceFiles(goldenDir, evidenceDir);
    }
  }

  if (errors.length) {
    console.error('Trace comparison failed:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Trace comparison passed.');
};

main().catch((error) => {
  console.error('Trace comparison failed:', error);
  process.exit(1);
});
