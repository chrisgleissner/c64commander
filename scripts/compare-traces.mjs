#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright');
const goldenRoot = path.resolve(process.env.TRACE_GOLDEN_DIR || path.join(process.cwd(), 'test-results', 'traces', 'golden'));

const errors = [];

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

const normalizeHostLike = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return '***';
  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) return '***';
  if (/^[a-z0-9.-]+$/i.test(trimmed) && trimmed.includes('.')) return '***';
  return value;
};

const normalizeDataFields = (value) => {
  if (Array.isArray(value)) return value.map((entry) => normalizeDataFields(entry));
  if (value && typeof value === 'object') {
    const normalized = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (/host|hostname|ip|address|port/i.test(key)) {
        normalized[key] = normalizeHostLike(entry);
        return;
      }
      normalized[key] = normalizeDataFields(entry);
    });
    return normalized;
  }
  return normalizeHostLike(value);
};

const formatId = (prefix, value) => `${prefix}-${String(value).padStart(5, '0')}`;
const isTraceId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}-\\d{5}$`).test(value);

const normalizeTrace = (events) => {
  let expectedId = 0;
  return events.map((event) => {
    const normalized = { ...event };
    const expected = formatId('EVT', expectedId);
    if (!isTraceId(normalized.id, 'EVT')) {
      errors.push(`Invalid trace id: ${normalized.id}`);
    } else if (normalized.id !== expected) {
      errors.push(`Unexpected trace id ${normalized.id}; expected ${expected}`);
    }
    expectedId += 1;
    if (!isTraceId(normalized.correlationId, 'COR')) {
      errors.push(`Invalid correlationId: ${normalized.correlationId}`);
    }
    delete normalized.timestamp;
    normalized.relativeMs = 0;
    if (normalized.data && typeof normalized.data === 'object') {
      const data = normalizeDataFields({ ...normalized.data });
      if (typeof data.url === 'string') data.url = normalizeUrl(data.url);
      if (typeof data.normalizedUrl === 'string') data.normalizedUrl = normalizeUrl(data.normalizedUrl);
      if (data.headers) data.headers = normalizeHeaders(data.headers);
      if ('durationMs' in data) delete data.durationMs;
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

const readMetaJson = async (dir) => {
  const filePath = path.join(dir, 'meta.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const normalizeMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return meta;
  const normalized = { ...meta };
  delete normalized.timestamp;
  delete normalized.status;
  return normalized;
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

  const goldenMeta = await readMetaJson(goldenDir).catch(() => null);
  const evidenceMeta = await readMetaJson(evidenceDir).catch(() => null);
  if (!goldenMeta || !evidenceMeta) {
    errors.push(`meta.json missing for ${path.relative(goldenRoot, goldenDir)}`);
    return;
  }

  const normalizedGoldenMeta = normalizeMeta(goldenMeta);
  const normalizedEvidenceMeta = normalizeMeta(evidenceMeta);
  const metaGoldenString = JSON.stringify(normalizedGoldenMeta, null, 2);
  const metaEvidenceString = JSON.stringify(normalizedEvidenceMeta, null, 2);
  if (metaGoldenString !== metaEvidenceString) {
    errors.push(`Meta mismatch for ${path.relative(goldenRoot, goldenDir)}`);
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
