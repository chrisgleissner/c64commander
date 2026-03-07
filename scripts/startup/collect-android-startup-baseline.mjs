#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseStartupMetricsFromFile,
  summarizeTtfsc,
} from './startupMetrics.mjs';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split('=');
    return [key, value ?? ''];
  }),
);

const appId =
  args.get('--appId') || process.env.C64_APP_ID || 'uk.gleissner.c64commander';
const activity =
  args.get('--activity') ||
  process.env.C64_APP_ACTIVITY ||
  'uk.gleissner.c64commander/.MainActivity';
const loops = Number(args.get('--loops') || process.env.STARTUP_LOOPS || '10');
const outDir =
  args.get('--outDir') ||
  process.env.STARTUP_ARTIFACT_DIR ||
  'ci-artifacts/startup';
const serial = args.get('--serial') || process.env.ANDROID_SERIAL || '';

const adbArgs = (extra) => (serial ? ['-s', serial, ...extra] : extra);

const runAdb = (extra, options = {}) => {
  const result = spawnSync('adb', adbArgs(extra), {
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `adb ${extra.join(' ')} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
};

const launchActivity = () => {
  const timedStart = spawnSync(
    'adb',
    adbArgs(['shell', 'am', 'start', '-W', '-n', activity]),
    {
      encoding: 'utf8',
      timeout: 25_000,
    },
  );

  if (timedStart.status === 0) {
    return timedStart.stdout;
  }

  const timedOut =
    timedStart.error?.code === 'ETIMEDOUT' || timedStart.status === 124;
  const startOutput =
    `${timedStart.stdout ?? ''}\n${timedStart.stderr ?? ''}`.trim();
  const looksLikeLaunchStarted =
    /Starting:\s+Intent/i.test(startOutput) &&
    !/(Error:|Exception|Activity class .* does not exist|Unable to resolve|Permission denied)/i.test(
      startOutput,
    );
  if (!timedOut && !looksLikeLaunchStarted) {
    const stderr =
      timedStart.stderr ||
      timedStart.stdout ||
      timedStart.error?.message ||
      'unknown error';
    throw new Error(`adb shell am start -W -n ${activity} failed: ${stderr}`);
  }

  const fallback = spawnSync(
    'adb',
    adbArgs(['shell', 'am', 'start', '-n', activity]),
    {
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  if (fallback.status !== 0) {
    const fallbackError =
      fallback.stderr ||
      fallback.stdout ||
      fallback.error?.message ||
      'unknown error';
    throw new Error(
      `adb shell am start -n ${activity} fallback failed after start -W timeout: ${fallbackError}`,
    );
  }

  return `${timedStart.stdout}\n${timedStart.stderr}\nFallback start used after start -W non-success.`;
};

mkdirSync(outDir, { recursive: true });

const ttfscSamples = [];
const iterationMetrics = [];

for (let index = 1; index <= loops; index += 1) {
  const logPath = path.join(outDir, `startup-loop-${index}.logcat.txt`);
  runAdb(['logcat', '-c']);
  runAdb(['shell', 'am', 'force-stop', appId]);

  const startResult = launchActivity();
  const thisTimeMatch = startResult.match(/ThisTime:\s*(\d+)/);
  const totalTimeMatch = startResult.match(/TotalTime:\s*(\d+)/);
  const ttfsc = Number(totalTimeMatch?.[1] || thisTimeMatch?.[1] || '0');
  if (ttfsc > 0) {
    ttfscSamples.push(ttfsc);
  }

  const logResult = runAdb(['logcat', '-d']);
  writeFileSync(logPath, logResult, 'utf8');

  const metrics = parseStartupMetricsFromFile(logPath);
  iterationMetrics.push({
    iteration: index,
    ttfscMs: ttfsc,
    ...metrics,
  });
}

const userLatencySamples = iterationMetrics
  .flatMap((entry) => entry.UserTriggeredCommandLatencyMs.samples)
  .filter((value) => Number.isFinite(value));

const summary = {
  appId,
  activity,
  loops,
  generatedAt: new Date().toISOString(),
  metrics: {
    TTFSC: summarizeTtfsc(ttfscSamples),
    StartupRequestCount: summarizeTtfsc(
      iterationMetrics.map((entry) => entry.StartupRequestCount),
    ),
    StartupConfigCalls: summarizeTtfsc(
      iterationMetrics.map((entry) => entry.StartupConfigCalls),
    ),
    DuplicateStartupConfigKeyRequests: summarizeTtfsc(
      iterationMetrics.map((entry) => entry.DuplicateStartupConfigKeyRequests),
    ),
    StartupBacklogDepth: summarizeTtfsc(
      iterationMetrics.map((entry) => entry.StartupBacklogDepth),
    ),
    UserTriggeredCommandLatencyMs: summarizeTtfsc(userLatencySamples),
    NullStringWarningCount: summarizeTtfsc(
      iterationMetrics.map((entry) => entry.NullStringWarningCount),
    ),
    HvscStartupDownloads: summarizeTtfsc(
      iterationMetrics.map((entry) => entry.HvscStartupDownloads),
    ),
  },
  iterations: iterationMetrics,
};

const outputPath = path.join(outDir, 'startup-baseline.json');
writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf8');
process.stdout.write(`${outputPath}\n`);
