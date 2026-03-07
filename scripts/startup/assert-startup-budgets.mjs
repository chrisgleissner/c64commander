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

const budgets = {
  StartupRequestCount: Number(process.env.STARTUP_REQUEST_BUDGET || '25'),
  StartupConfigCalls: Number(process.env.STARTUP_CONFIG_BUDGET || '12'),
  DuplicateStartupConfigKeyRequests: Number(
    process.env.STARTUP_DUPLICATE_CONFIG_BUDGET || '0',
  ),
  TTFSC_P50: Number(process.env.STARTUP_TTFSC_P50_BUDGET_MS || '5000'),
  TTFSC_P95: Number(process.env.STARTUP_TTFSC_P95_BUDGET_MS || '8000'),
  StartupBacklogDepth: Number(process.env.STARTUP_BACKLOG_BUDGET || '40'),
  UserTriggeredCommandLatencyMsP95: Number(
    process.env.STARTUP_USER_COMMAND_P95_BUDGET_MS || '900',
  ),
};

const checks = [
  [
    'StartupRequestCount p95',
    summary.metrics.StartupRequestCount.p95,
    budgets.StartupRequestCount,
  ],
  [
    'StartupConfigCalls p95',
    summary.metrics.StartupConfigCalls.p95,
    budgets.StartupConfigCalls,
  ],
  [
    'DuplicateStartupConfigKeyRequests p95',
    summary.metrics.DuplicateStartupConfigKeyRequests.p95,
    budgets.DuplicateStartupConfigKeyRequests,
  ],
  ['TTFSC p50', summary.metrics.TTFSC.p50, budgets.TTFSC_P50],
  ['TTFSC p95', summary.metrics.TTFSC.p95, budgets.TTFSC_P95],
  [
    'StartupBacklogDepth p95',
    summary.metrics.StartupBacklogDepth.p95,
    budgets.StartupBacklogDepth,
  ],
  [
    'UserTriggeredCommandLatencyMs p95',
    summary.metrics.UserTriggeredCommandLatencyMs.p95,
    budgets.UserTriggeredCommandLatencyMsP95,
  ],
];

let failed = false;
for (const [name, actual, max] of checks) {
  const value = Number(actual ?? 0);
  if (value > max) {
    process.stderr.write(`${name} exceeded budget: ${value} > ${max}\n`);
    failed = true;
  } else {
    process.stdout.write(`${name}: ${value} <= ${max}\n`);
  }
}

if (failed) {
  process.exit(1);
}
