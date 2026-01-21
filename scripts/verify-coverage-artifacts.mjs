#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const expectWeb = process.env.EXPECT_WEB_COVERAGE === '1';
const expectAndroid = process.env.EXPECT_ANDROID_COVERAGE === '1';

const targets = [];
if (expectWeb) {
  targets.push(
    { label: 'unit lcov', file: 'coverage/lcov.info' },
    { label: 'e2e lcov', file: 'coverage/e2e/lcov.info' },
    { label: 'merged lcov', file: 'coverage/lcov-merged.info' },
  );
}
if (expectAndroid) {
  targets.push(
    { label: 'android jacoco', file: 'android/app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml' },
  );
}

if (!targets.length) {
  console.log('No coverage artifacts required for this job.');
  process.exit(0);
}

const errors = [];
const existing = [];

for (const target of targets) {
  const filePath = path.resolve(root, target.file);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      errors.push(`${target.label} is not a file: ${target.file}`);
      continue;
    }
    if (stat.size === 0) {
      errors.push(`${target.label} is empty: ${target.file}`);
      continue;
    }
    existing.push(`${target.label}: ${target.file}`);
  } catch {
    errors.push(`${target.label} missing: ${target.file}`);
  }
}

if (existing.length) {
  console.log('Coverage artifacts found:\n' + existing.join('\n'));
}

if (errors.length) {
  console.error('Missing or invalid coverage artifacts:\n' + errors.join('\n'));
  process.exit(1);
}

console.log('Coverage artifacts validated.');
