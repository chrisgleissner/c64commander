#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const gitDir = path.join(repoRoot, '.git');

if (!existsSync(gitDir)) {
    process.exit(0);
}

const probeResult = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: repoRoot,
    stdio: 'ignore',
});

if (probeResult.error || probeResult.status !== 0) {
    process.exit(0);
}

const configuredResult = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repoRoot,
    encoding: 'utf8',
});

// A configured path belongs to the user, including an inherited or deliberately empty value.
if (configuredResult.status === 0) {
    process.exit(0);
}
if (configuredResult.error || configuredResult.status !== 1) {
    console.error(`Could not inspect Git hook configuration in ${repoRoot}:`,
        configuredResult.error ?? configuredResult.stderr);
    process.exit(configuredResult.status ?? 1);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: repoRoot,
    stdio: 'inherit',
});

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}
