#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const defaultCoverageFile = 'coverage/lcov-merged.info';
const fallbackCoverageFile = 'coverage/lcov.info';
const coverageFile = process.env.COVERAGE_FILE ?? defaultCoverageFile;
const minLineCoverage = Number(process.env.COVERAGE_MIN ?? '90');
const minBranchCoverage = Number(process.env.COVERAGE_MIN_BRANCH ?? '90');

const filePath = path.resolve(process.cwd(), coverageFile);
let content = '';

try {
  content = await fs.readFile(filePath, 'utf8');
} catch (error) {
  const isDefault =
    coverageFile === defaultCoverageFile && !process.env.COVERAGE_FILE;
  if (!isDefault || error?.code !== 'ENOENT') {
    throw error;
  }

  const fallbackPath = path.resolve(process.cwd(), fallbackCoverageFile);
  content = await fs.readFile(fallbackPath, 'utf8');
  console.warn(
    `Coverage file ${coverageFile} missing; using ${fallbackCoverageFile} instead.`,
  );
}

let summaryTotalLines = 0;
let summaryCoveredLines = 0;
let detailTotalLines = 0;
let detailCoveredLines = 0;
let summaryTotalBranches = 0;
let summaryCoveredBranches = 0;
let detailTotalBranches = 0;
let detailCoveredBranches = 0;

for (const line of content.split('\n')) {
  if (line.startsWith('LF:')) {
    summaryTotalLines += Number(line.slice(3)) || 0;
  } else if (line.startsWith('LH:')) {
    summaryCoveredLines += Number(line.slice(3)) || 0;
  } else if (line.startsWith('DA:')) {
    const parts = line.slice(3).split(',');
    if (parts.length >= 2) {
      const hitCount = Number(parts[1]) || 0;
      detailTotalLines += 1;
      if (hitCount > 0) {
        detailCoveredLines += 1;
      }
    }
  } else if (line.startsWith('BRF:')) {
    summaryTotalBranches += Number(line.slice(4)) || 0;
  } else if (line.startsWith('BRH:')) {
    summaryCoveredBranches += Number(line.slice(4)) || 0;
  } else if (line.startsWith('BRDA:')) {
    const parts = line.slice(5).split(',');
    if (parts.length >= 4) {
      const hitRaw = parts[3]?.trim() ?? '0';
      const hitCount = hitRaw === '-' ? 0 : Number(hitRaw) || 0;
      detailTotalBranches += 1;
      if (hitCount > 0) {
        detailCoveredBranches += 1;
      }
    }
  }
}

const useLineDetail = detailTotalLines > 0;
const totalLines = useLineDetail ? detailTotalLines : summaryTotalLines;
const coveredLines = useLineDetail ? detailCoveredLines : summaryCoveredLines;

const useBranchDetail = detailTotalBranches > 0;
const totalBranches = useBranchDetail
  ? detailTotalBranches
  : summaryTotalBranches;
const coveredBranches = useBranchDetail
  ? detailCoveredBranches
  : summaryCoveredBranches;

if (totalLines === 0) {
  console.error(`No coverage entries found in ${coverageFile}`);
  process.exit(1);
}

if (totalBranches === 0) {
  console.error(`No branch coverage entries found in ${coverageFile}`);
  process.exit(1);
}

const linePercent = totalLines === 0 ? 0 : (coveredLines / totalLines) * 100;
const branchPercent =
  totalBranches === 0 ? 0 : (coveredBranches / totalBranches) * 100;
const lineSummary = `Line coverage: ${linePercent.toFixed(2)}% (covered ${coveredLines} / ${totalLines})`;
const branchSummary = `Branch coverage: ${branchPercent.toFixed(2)}% (covered ${coveredBranches} / ${totalBranches})`;

console.log(lineSummary);
console.log(branchSummary);

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `- ${lineSummary}\n- ${branchSummary}\n`,
    'utf8',
  );
}

if (linePercent + 1e-6 < minLineCoverage) {
  console.error(
    `Line coverage below minimum threshold: ${linePercent.toFixed(2)}% < ${minLineCoverage}%`,
  );
  process.exit(1);
}

if (branchPercent + 1e-6 < minBranchCoverage) {
  console.error(
    `Branch coverage below minimum threshold: ${branchPercent.toFixed(2)}% < ${minBranchCoverage}%`,
  );
  process.exit(1);
}
