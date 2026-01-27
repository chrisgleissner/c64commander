#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const shardArg = args.find((arg) => arg.startsWith('--shard='));
const totalArg = args.find((arg) => arg.startsWith('--total='));

const shardIndex = shardArg ? Number(shardArg.split('=')[1]) : NaN;
const shardTotal = totalArg ? Number(totalArg.split('=')[1]) : NaN;

if (!Number.isFinite(shardIndex) || !Number.isFinite(shardTotal) || shardIndex < 1 || shardIndex > shardTotal) {
  console.error('Usage: node scripts/get-playwright-shard-files.mjs --shard=<index> --total=<count>');
  process.exit(1);
}

const listCommand = 'PLAYWRIGHT_SKIP_BUILD=1 PLAYWRIGHT_SKIP_WEB_SERVER=1 npx playwright test --list --project=android-phone';
let output = '';
try {
  output = execSync(listCommand, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  console.error('Failed to list Playwright tests:', error?.message ?? error);
  process.exit(1);
}

const fileCounts = new Map();
const linePattern = /\] › ([^:]+):\d+:\d+ ›/;

for (const line of output.split('\n')) {
  const match = line.match(linePattern);
  if (!match) continue;
  const rawFile = match[1].trim();
  if (!rawFile) continue;
  const normalized = rawFile.includes('/') ? rawFile : path.join('playwright', rawFile);
  fileCounts.set(normalized, (fileCounts.get(normalized) ?? 0) + 1);
}

const entries = Array.from(fileCounts.entries()).sort((a, b) => b[1] - a[1]);
const shards = Array.from({ length: shardTotal }, () => ({ files: [], count: 0 }));

for (const [file, count] of entries) {
  let targetIndex = 0;
  for (let i = 1; i < shards.length; i += 1) {
    if (shards[i].count < shards[targetIndex].count) {
      targetIndex = i;
    }
  }
  shards[targetIndex].files.push(file);
  shards[targetIndex].count += count;
}

const shardFiles = shards[shardIndex - 1]?.files ?? [];
if (shardFiles.length === 0) {
  console.error(`No files assigned to shard ${shardIndex}/${shardTotal}`);
  process.exit(1);
}

process.stdout.write(shardFiles.join('\n'));
