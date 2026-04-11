#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeScenarioIterations, summarizeSecondaryIterations } from './webPerfSummary.mjs';
import { loadPerfIterationArtifact } from './webPerfArtifacts.mjs';
import { resolveWebPerfRunProfile } from './webPerfEvidence.mjs';
import { ensureRealArchivePair } from './realArchiveCache.mjs';

const args = new Map(
    process.argv.slice(2).map((arg) => {
        const [key, value] = arg.split('=');
        return [key, value ?? ''];
    }),
);

const homeCacheDir = path.join(os.homedir(), '.cache', 'c64commander', 'hvsc');

const useRealArchives =
    args.get('--use-real-archives') === '1' || process.env.HVSC_PERF_USE_REAL_ARCHIVES === '1';
const loops = Number(args.get('--loops') || process.env.HVSC_PERF_LOOPS || '3');
const project = args.get('--project') || process.env.HVSC_PERF_PROJECT || 'web';
const suite = args.get('--suite') || process.env.HVSC_PERF_SUITE || 'secondary';
const bytesPerSecond =
    args.get('--bytes-per-second') || process.env.HVSC_PERF_BYTES_PER_SECOND || String(5 * 1024 * 1024);
const outFile =
    args.get('--out') || process.env.HVSC_PERF_SUMMARY_FILE || 'ci-artifacts/hvsc-performance/web/web-secondary.json';
const tmpDir = path.resolve('.tmp', 'hvsc-perf');
const { baselineArchive, updateArchive } = useRealArchives
    ? await ensureRealArchivePair({ env: process.env, homeCacheDir })
    : { baselineArchive: null, updateArchive: null };

if (useRealArchives && (!baselineArchive || !updateArchive)) {
    process.stderr.write(
        'Real archive mode requested, but the HVSC baseline/update archives could not be resolved. ' +
        'Populate ~/.cache/c64commander/hvsc or set HVSC_PERF_BASELINE_ARCHIVE and HVSC_PERF_UPDATE_ARCHIVE.\n',
    );
    process.exit(1);
}

const runProfile = resolveWebPerfRunProfile({ suite, useRealArchives });

await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });
mkdirSync(path.dirname(outFile), { recursive: true });

if (!runProfile.supported) {
    const summary = {
        generatedAt: new Date().toISOString(),
        scenario: suite === 'scenarios' ? 'web-hvsc-s1-s11' : 'web-browse-playback-secondary',
        suite,
        loops,
        project,
        bytesPerSecond: Number(bytesPerSecond),
        mode: runProfile.mode,
        evidenceClass: runProfile.evidenceClass,
        limitations: runProfile.limitations,
        archives: {
            baselineArchive,
            updateArchive,
        },
        status: 'unsupported',
        runnerExitCode: 0,
        ...summarizeScenarioIterations([], { evidenceClass: runProfile.evidenceClass }),
        iterations: [],
    };

    writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');
    process.stdout.write(`${path.resolve(outFile)}\n`);
    process.exit(0);
}

const iterations = [];
let overallExitCode = 0;
for (let index = 0; index < loops; index += 1) {
    const rawFile = path.join(tmpDir, `loop-${String(index + 1).padStart(2, '0')}.json`);
    const specPath = suite === 'scenarios' ? 'playwright/hvscPerfScenarios.spec.ts' : 'playwright/hvscPerf.spec.ts';
    const result = spawnSync(
        'npx',
        ['playwright', 'test', specPath, '--project', project, '--reporter=line'],
        {
            stdio: 'inherit',
            env: {
                ...process.env,
                HVSC_PERF_OUTPUT_FILE: suite === 'secondary' ? rawFile : '',
                HVSC_PERF_SCENARIOS_OUTPUT_FILE: suite === 'scenarios' ? rawFile : '',
                HVSC_PERF_BYTES_PER_SECOND: bytesPerSecond,
                HVSC_PERF_BASELINE_ARCHIVE: baselineArchive ?? '',
                HVSC_PERF_UPDATE_ARCHIVE: updateArchive ?? '',
                PLAYWRIGHT_DEVICES: 'web',
            },
        },
    );
    const iteration = loadPerfIterationArtifact({ rawFile, exitStatus: result.status ?? 1 });
    if (iteration) {
        iterations.push(iteration);
    }
    if (result.status !== 0) {
        overallExitCode = result.status ?? 1;
        if (!iteration) {
            process.exit(overallExitCode);
        }
        break;
    }
}

const suiteSummary = suite === 'scenarios'
    ? summarizeScenarioIterations(iterations, { evidenceClass: runProfile.evidenceClass })
    : { metrics: summarizeSecondaryIterations(iterations) };

const summary = {
    generatedAt: new Date().toISOString(),
    scenario: suite === 'scenarios' ? 'web-hvsc-s1-s11' : 'web-browse-playback-secondary',
    suite,
    loops,
    project,
    bytesPerSecond: Number(bytesPerSecond),
    mode: runProfile.mode,
    evidenceClass: runProfile.evidenceClass,
    limitations: runProfile.limitations,
    archives: {
        baselineArchive,
        updateArchive,
    },
    status: overallExitCode === 0 ? 'passed' : 'failed',
    runnerExitCode: overallExitCode,
    ...suiteSummary,
    iterations,
};

writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');
process.stdout.write(`${path.resolve(outFile)}\n`);
if (overallExitCode !== 0) {
    process.exit(overallExitCode);
}
