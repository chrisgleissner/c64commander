#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  compareTraceFiles,
  formatTraceErrors,
  resolveGoldenRoot,
} from '../playwright/traceComparison.js';

const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright');
const goldenRoot = resolveGoldenRoot();
const requireGoldens = process.env.TRACE_GOLDEN_REQUIRED === '1';
const errors = [];

const listDirs = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
};

const main = async () => {
  const goldenStat = await fs.stat(goldenRoot).catch(() => null);
  if (!goldenStat || !goldenStat.isDirectory()) {
    if (!requireGoldens) {
      console.log(`Trace comparison skipped: golden directory missing (${goldenRoot}).`);
      return;
    }
    errors.push(`Golden trace directory missing: ${goldenRoot}`);
  }

  const goldenSuites = await listDirs(goldenRoot);
  if (goldenSuites.length === 0) {
    if (!requireGoldens) {
      console.log(`Trace comparison skipped: golden directory empty (${goldenRoot}).`);
      return;
    }
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
      const traceErrors = await compareTraceFiles(goldenDir, evidenceDir);
      if (traceErrors.length) {
        errors.push(formatTraceErrors(traceErrors, relative));
      }
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
