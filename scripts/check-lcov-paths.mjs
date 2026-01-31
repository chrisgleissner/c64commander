#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const coverageFile = process.env.LCOV_FILE ?? 'coverage/lcov-merged.info';
const minSrcFiles = Number(process.env.MIN_SRC_FILES ?? '50');
const minSrcLines = Number(process.env.MIN_SRC_LINES ?? '2000');

const filePath = path.resolve(root, coverageFile);
const content = await fs.readFile(filePath, 'utf8');

const entries = new Map();
let current = null;
let sawSF = false;

const normalizeRepoPath = (value) => {
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(normalized)) {
    const relative = path.relative(root, normalized).replace(/\\/g, '/');
    if (!relative.startsWith('..')) {
      return relative;
    }
  }
  const srcIndex = normalized.indexOf('/src/');
  if (!normalized.startsWith('src/') && srcIndex !== -1) {
    return normalized.slice(srcIndex + 1);
  }
  return normalized;
};

for (const line of content.split('\n')) {
  if (line.startsWith('SF:')) {
    const rawPath = line.slice(3).trim();
    const repoPath = normalizeRepoPath(rawPath);
    current = repoPath;
    sawSF = true;
    if (!entries.has(repoPath)) {
      entries.set(repoPath, { totalLines: 0, sawLF: false });
    }
    continue;
  }
  if (!current) {
    continue;
  }
  if (line.startsWith('LF:')) {
    const value = Number(line.slice(3)) || 0;
    const entry = entries.get(current);
    entry.totalLines += value;
    entry.sawLF = true;
  } else if (line.startsWith('DA:')) {
    const entry = entries.get(current);
    if (entry.sawLF) {
      continue;
    }
    entry.totalLines += 1;
  }
}

if (!sawSF) {
  console.error(`No SF entries found in ${coverageFile}`);
  process.exit(1);
}

let srcFileCount = 0;
let srcLineCount = 0;

for (const [repoPath, entry] of entries.entries()) {
  if (!repoPath.startsWith('src/')) {
    continue;
  }
  const fullPath = path.join(root, repoPath);
  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      continue;
    }
  } catch {
    continue;
  }
  srcFileCount += 1;
  srcLineCount += entry.totalLines;
}

const summary = `LCOV src entries: ${srcFileCount} files, ${srcLineCount} lines`;
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `- ${summary}\n`, 'utf8');
}

if (srcFileCount < minSrcFiles || srcLineCount < minSrcLines) {
  console.error(
    `LCOV source coverage too small: ${srcFileCount} files (min ${minSrcFiles}), ${srcLineCount} lines (min ${minSrcLines}).`
  );
  process.exit(1);
}
