#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split('=');
    return [key, value ?? ''];
  }),
);

const filePath =
  args.get('--file') || 'ci-artifacts/startup/startup-baseline.json';
const summary = JSON.parse(readFileSync(filePath, 'utf8'));
const hvscDownloadsP95 = Number(summary.metrics.HvscStartupDownloads.p95 ?? 0);

if (hvscDownloadsP95 > 0) {
  process.stderr.write(
    `HVSC startup safety failed: startup includes HVSC download activity (p95=${hvscDownloadsP95})\n`,
  );
  process.exit(1);
}

process.stdout.write(
  'HVSC startup safety passed: no startup HVSC download activity detected.\n',
);
