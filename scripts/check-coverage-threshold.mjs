#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const defaultCoverageFile = 'coverage/lcov-merged.info';
const fallbackCoverageFile = 'coverage/lcov.info';
const coverageFile = process.env.COVERAGE_FILE ?? defaultCoverageFile;
const minLineCoverage = Number(process.env.COVERAGE_MIN ?? '80');
const minBranchCoverage = Number(process.env.COVERAGE_MIN_BRANCH ?? '82');

const filePath = path.resolve(process.cwd(), coverageFile);
let content = '';

try {
  content = await fs.readFile(filePath, 'utf8');
} catch (error) {
  const isDefault = coverageFile === defaultCoverageFile && !process.env.COVERAGE_FILE;
  if (!isDefault || error?.code !== 'ENOENT') {
    throw error;
  }

  const fallbackPath = path.resolve(process.cwd(), fallbackCoverageFile);
  content = await fs.readFile(fallbackPath, 'utf8');
  console.warn(`Coverage file ${coverageFile} missing; using ${fallbackCoverageFile} instead.`);
}

let totalLines = 0;
let coveredLines = 0;
let totalBranches = 0;
let coveredBranches = 0;
let sawSummary = false;
let sawDA = false;
let sawBranchSummary = false;
let sawBRDA = false;

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
  } else if (line.startsWith('BRF:')) {
    totalBranches += Number(line.slice(4)) || 0;
    sawBranchSummary = true;
  } else if (line.startsWith('BRH:')) {
    coveredBranches += Number(line.slice(4)) || 0;
    sawBranchSummary = true;
  } else if (line.startsWith('BRDA:')) {
    const parts = line.slice(5).split(',');
    if (parts.length >= 4) {
      const hitRaw = parts[3]?.trim() ?? '0';
      const hitCount = hitRaw === '-' ? 0 : Number(hitRaw) || 0;
      totalBranches += 1;
      if (hitCount > 0) {
        coveredBranches += 1;
      }
      sawBRDA = true;
    }
  }
}

if (!sawSummary && !sawDA) {
  console.error(`No coverage entries found in ${coverageFile}`);
  process.exit(1);
}

if (!sawBranchSummary && !sawBRDA) {
  console.error(`No branch coverage entries found in ${coverageFile}`);
  process.exit(1);
}

const linePercent = totalLines === 0 ? 0 : (coveredLines / totalLines) * 100;
const branchPercent = totalBranches === 0 ? 0 : (coveredBranches / totalBranches) * 100;
const lineSummary = `Line coverage: ${linePercent.toFixed(2)}% (covered ${coveredLines} / ${totalLines})`;
const branchSummary = `Branch coverage: ${branchPercent.toFixed(2)}% (covered ${coveredBranches} / ${totalBranches})`;

console.log(lineSummary);
console.log(branchSummary);

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `- ${lineSummary}\n- ${branchSummary}\n`, 'utf8');
}

if (linePercent + 1e-6 < minLineCoverage) {
  console.error(`Line coverage below minimum threshold: ${linePercent.toFixed(2)}% < ${minLineCoverage}%`);
  process.exit(1);
}

if (branchPercent + 1e-6 < minBranchCoverage) {
  console.error(`Branch coverage below minimum threshold: ${branchPercent.toFixed(2)}% < ${minBranchCoverage}%`);
  process.exit(1);
}
