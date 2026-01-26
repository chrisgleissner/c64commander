import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

const parseArg = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
};

const parseDurationMs = (value) => {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  if (trimmed.endsWith('ms')) return Number(trimmed.replace('ms', ''));
  if (trimmed.endsWith('s')) return Number(trimmed.replace('s', '')) * 1000;
  if (trimmed.endsWith('m')) return Number(trimmed.replace('m', '')) * 60_000;
  if (trimmed.endsWith('h')) return Number(trimmed.replace('h', '')) * 3_600_000;
  return undefined;
};

const seed = parseArg('--seed');
const steps = parseArg('--steps');
const timeBudget = parseArg('--time-budget');
const lastInteractions = parseArg('--last-interactions');
const platform = parseArg('--platform');
const runMode = parseArg('--run-mode');

const env = {
  ...process.env,
  FUZZ_RUN: '1',
  VITE_FUZZ_MODE: '1',
};

if (seed) env.FUZZ_SEED = seed;
if (steps) env.FUZZ_MAX_STEPS = steps;
if (lastInteractions) env.FUZZ_LAST_INTERACTIONS = lastInteractions;
if (platform) env.FUZZ_PLATFORM = platform;
if (runMode) env.FUZZ_RUN_MODE = runMode;

const budgetMs = parseDurationMs(timeBudget);
if (budgetMs) env.FUZZ_TIME_BUDGET_MS = String(budgetMs);

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(
  cmd,
  ['playwright', 'test', 'playwright/fuzz/chaosRunner.fuzz.ts', '--workers=1'],
  { stdio: 'inherit', env },
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
