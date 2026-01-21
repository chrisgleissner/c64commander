#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const coverageFile = process.env.COVERAGE_FILE ?? 'coverage/lcov-merged.info';
const limit = Number(process.env.COVERAGE_LIMIT ?? '20');
const minLines = Number(process.env.COVERAGE_MIN_LINES ?? '50');

const content = await fs.readFile(path.resolve(process.cwd(), coverageFile), 'utf8');

const files = [];
let current = null;

const pushCurrent = () => {
  if (!current) return;
  files.push(current);
  current = null;
};

for (const line of content.split('\n')) {
  if (line.startsWith('SF:')) {
    pushCurrent();
    current = { file: line.slice(3), total: 0, covered: 0 };
  } else if (line.startsWith('DA:') && current) {
    const parts = line.slice(3).split(',');
    if (parts.length >= 2) {
      const hits = Number(parts[1]) || 0;
      current.total += 1;
      if (hits > 0) current.covered += 1;
    }
  } else if (line.startsWith('end_of_record')) {
    pushCurrent();
  }
}

pushCurrent();

const candidates = files.filter((entry) => entry.total >= minLines);
const sorted = candidates.sort((a, b) => (a.covered / a.total) - (b.covered / b.total));
const worst = sorted.slice(0, limit);

if (!worst.length) {
  console.log('No coverage entries found.');
  process.exit(0);
}

console.log(`Lowest coverage files (min lines: ${minLines}):`);
for (const entry of worst) {
  const percent = entry.total ? (entry.covered / entry.total) * 100 : 0;
  console.log(`${percent.toFixed(2)}% ${entry.covered}/${entry.total} ${entry.file}`);
}
