#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const coverageFile = process.env.COVERAGE_FILE ?? 'coverage/lcov-merged.info';
const minCoverage = Number(process.env.COVERAGE_MIN ?? '80');

const filePath = path.resolve(process.cwd(), coverageFile);
const content = await fs.readFile(filePath, 'utf8');

let totalLines = 0;
let coveredLines = 0;
let sawSummary = false;
let sawDA = false;

for (const line of content.split('\n')) {
  if (line.startsWith('LF:')) {
    totalLines += Number(line.slice(3)) || 0;
    sawSummary = true;
  } else if (line.startsWith('LH:')) {
    coveredLines += Number(line.slice(3)) || 0;
    sawSummary = true;
  } else if (line.startsWith('DA:')) {
    const parts = line.slice(3).split(',');
    if (parts.length >= 2) {
      const hitCount = Number(parts[1]) || 0;
      totalLines += 1;
      if (hitCount > 0) {
        coveredLines += 1;
      }
      sawDA = true;
    }
  }
}

if (!sawSummary && !sawDA) {
  console.error(`No coverage entries found in ${coverageFile}`);
  process.exit(1);
}

const percent = totalLines === 0 ? 0 : (coveredLines / totalLines) * 100;
const summary = `Line coverage: ${percent.toFixed(2)}% (covered ${coveredLines} / ${totalLines})`;

console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `- ${summary}\n`, 'utf8');
}

if (percent + 1e-6 < minCoverage) {
  console.error(`Coverage below minimum threshold: ${percent.toFixed(2)}% < ${minCoverage}%`);
  process.exit(1);
}
