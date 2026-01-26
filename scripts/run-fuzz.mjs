import { spawn } from 'node:child_process';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
const concurrencyArg = parseArg('--concurrency');

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

const baseSeed = seed ? Number(seed) : 1337;
const concurrency = Math.max(1, Number(concurrencyArg || env.FUZZ_CONCURRENCY || os.cpus().length));
const runId = env.FUZZ_RUN_ID || `${baseSeed}`;

const buildOutputRoot = () => {
  const resolvedRunMode = env.FUZZ_RUN_MODE || 'local';
  const resolvedPlatform = platform || env.FUZZ_PLATFORM || 'android-phone';
  return path.resolve(process.cwd(), 'test-results', 'fuzz', `run-${resolvedRunMode}-${resolvedPlatform}-${baseSeed}-${runId}`);
};

const mergeReports = async () => {
  const outputRoot = buildOutputRoot();
  const issueGroups = new Map();
  let totalSteps = 0;
  let sessions = 0;

  for (let shard = 0; shard < concurrency; shard += 1) {
    const reportPath = path.join(outputRoot, `shard-${shard}`, 'fuzz-issue-report.json');
    try {
      const raw = await fs.readFile(reportPath, 'utf8');
      const parsed = JSON.parse(raw);
      totalSteps += parsed?.meta?.totalSteps || 0;
      sessions += parsed?.meta?.sessions || 0;
      const groups = parsed?.issueGroups || [];
      for (const group of groups) {
        const existing = issueGroups.get(group.issue_group_id);
        if (!existing) {
          issueGroups.set(group.issue_group_id, {
            ...group,
            severityCounts: { ...group.severityCounts },
            platforms: Array.from(new Set(group.platforms || [])),
            examples: [...(group.examples || [])].slice(0, 3),
          });
          continue;
        }
        for (const [key, value] of Object.entries(group.severityCounts || {})) {
          existing.severityCounts[key] = (existing.severityCounts[key] || 0) + (value || 0);
        }
        existing.platforms = Array.from(new Set([...(existing.platforms || []), ...(group.platforms || [])]));
        if (existing.examples.length < 3) {
          existing.examples.push(...(group.examples || []).slice(0, 3 - existing.examples.length));
        }
      }
    } catch {
      // ignore missing shard reports
    }
  }

  const merged = {
    meta: {
      seed: baseSeed,
      platform: platform || env.FUZZ_PLATFORM || 'android-phone',
      runMode: env.FUZZ_RUN_MODE || 'local',
      maxSteps: steps ? Number(steps) : null,
      timeBudgetMs: budgetMs || null,
      totalSteps,
      sessions,
      shardTotal: concurrency,
      runId,
    },
    issueGroups: Array.from(issueGroups.values()),
  };

  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, 'fuzz-issue-report.json'), JSON.stringify(merged, null, 2), 'utf8');

  const summaryLines = ['# Chaos Fuzz Summary', ''];
  if (!merged.issueGroups.length) {
    summaryLines.push('No issues detected.');
  } else {
    for (const group of merged.issueGroups) {
      const totalCount = Object.values(group.severityCounts || {}).reduce((sum, value) => sum + (value || 0), 0);
      const exampleVideos = (group.examples || []).map((example) => example.video).filter(Boolean).slice(0, 3);
      summaryLines.push(`## ${group.issue_group_id}`);
      summaryLines.push('');
      summaryLines.push(`- Exception: ${group.signature?.exception || 'n/a'}`);
      summaryLines.push(`- Message: ${group.signature?.message || 'n/a'}`);
      summaryLines.push(`- Top frames: ${(group.signature?.topFrames || []).join(' | ') || 'n/a'}`);
      summaryLines.push(`- Total: ${totalCount}`);
      summaryLines.push(
        `- Severity: crash=${group.severityCounts.crash || 0} freeze=${group.severityCounts.freeze || 0} error=${group.severityCounts.errorLog || 0} warn=${group.severityCounts.warnLog || 0}`,
      );
      summaryLines.push(`- Platforms: ${(group.platforms || []).join(', ')}`);
      if (exampleVideos.length) {
        summaryLines.push(`- Videos: ${exampleVideos.join(', ')}`);
      }
      summaryLines.push('');
    }
  }

  await fs.writeFile(path.join(outputRoot, 'fuzz-issue-summary.md'), summaryLines.join('\n'), 'utf8');
};

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const basePort = Number(process.env.PLAYWRIGHT_PORT || '4173');

const runShard = (index) =>
  new Promise((resolve) => {
    const shardEnv = {
      ...env,
      FUZZ_RUN_ID: runId,
      FUZZ_SHARD_INDEX: String(index),
      FUZZ_SHARD_TOTAL: String(concurrency),
      FUZZ_SEED: String(baseSeed + index),
      PLAYWRIGHT_PORT: String(basePort + index),
      PLAYWRIGHT_OUTPUT_DIR: path.join('test-results', 'playwright-fuzz', `shard-${index}`),
      PLAYWRIGHT_REPORT_DIR: path.join('playwright-report', 'fuzz', `shard-${index}`),
    };

    const playwrightArgs = ['playwright', 'test', 'playwright/fuzz/chaosRunner.fuzz.ts', '--workers=1'];
    if (platform) {
      playwrightArgs.push('--project', platform);
    }

    const child = spawn(cmd, playwrightArgs, { stdio: 'inherit', env: shardEnv });
    child.on('exit', (code) => resolve(code ?? 1));
  });

const exitCodes = await Promise.all(Array.from({ length: concurrency }, (_, index) => runShard(index)));
await mergeReports();
const failed = exitCodes.find((code) => code !== 0);
process.exit(failed ?? 0);
