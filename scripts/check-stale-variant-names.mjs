#!/usr/bin/env node
/*
 * Guards against the re-introduction of the retired placeholder variant name
 * "c64u-controller" / "C64U Controller" / "c64ucontroller" in active project
 * outputs. The variant was migrated to "c64u-remote" / "C64U Remote" /
 * "uk.gleissner.c64uremote".
 *
 * History/run-log files and the historical design specs under docs/research/
 * are allowed to mention the old name to explain the migration; everything else
 * (config, scripts, app source, tests, Android/iOS/web resources, CI) must be
 * free of it. Searches tracked files via `git grep`.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// "c64ucontroller" also covers "uk.gleissner.c64ucontroller".
export const STALE_PATTERNS = ['c64u-controller', 'C64U Controller', 'c64ucontroller'];

// Files permitted to reference the old name to document the migration history.
export const ALLOWED_FILES = new Set([
    'WORKLOG.md',
    'PLANS.md',
    'scripts/check-stale-variant-names.mjs',
    'tests/unit/scripts/checkStaleVariantNames.test.ts',
    // Asserts the old variant is ABSENT (a migration regression guard), so it
    // legitimately references the old name.
    'tests/unit/scripts/variantAndroidOnly.test.ts',
]);

// Directory prefixes whose contents are historical/research/plan docs and exempt.
// The C64U Remote / keypad design docs live under docs/plans/callback8020/;
// the historical variant spec lives under docs/research/.
export const ALLOWED_PREFIXES = ['docs/research/', 'docs/plans/callback8020/'];

export const isAllowed = (relativePath) => {
    if (ALLOWED_FILES.has(relativePath)) return true;
    return ALLOWED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
};

const gitGrepFiles = (pattern) => {
    try {
        const output = execFileSync('git', ['grep', '-lF', '-e', pattern], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return output.split('\n').map((line) => line.trim()).filter(Boolean);
    } catch (error) {
        // git grep exits 1 when there are no matches; that is success here.
        if (error.status === 1 && !error.stderr?.toString().trim()) {
            return [];
        }
        throw error;
    }
};

export const findStaleReferences = () => {
    const offenders = new Map();
    for (const pattern of STALE_PATTERNS) {
        for (const file of gitGrepFiles(pattern)) {
            if (isAllowed(file)) continue;
            if (!offenders.has(file)) offenders.set(file, new Set());
            offenders.get(file).add(pattern);
        }
    }
    return offenders;
};

const isDirectInvocation = () => {
    const entry = process.argv[1];
    return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
    const offenders = findStaleReferences();
    if (offenders.size > 0) {
        console.error('Stale variant name(s) found in active outputs (should be c64u-remote):');
        for (const [file, patterns] of offenders) {
            console.error(`  - ${file}: ${[...patterns].join(', ')}`);
        }
        console.error('\nIf a reference is a legitimate migration note, add the file to ALLOWED_FILES/ALLOWED_PREFIXES.');
        process.exit(1);
    }
    console.log('no stale c64u-controller naming found in active outputs');
}
