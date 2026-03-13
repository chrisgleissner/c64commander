#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const gitDir = path.join(repoRoot, '.git');

if (!existsSync(gitDir)) {
    process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: repoRoot,
    stdio: 'inherit',
});

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}
