#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeScenarioIterations, summarizeSecondaryIterations } from './webPerfSummary.mjs';
import { loadPerfIterationArtifact } from './webPerfArtifacts.mjs';
import { resolveWebPerfRunProfile } from './webPerfEvidence.mjs';

const args = new Map(
    process.argv.slice(2).map((arg) => {
        const [key, value] = arg.split('=');
        return [key, value ?? ''];
    }),
);

const getGitValue = (gitArgs) => {
    const result = spawnSync('git', gitArgs, { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() || null : null;
};

const readJsonIfExists = (filePath) => {
    if (!filePath || !existsSync(filePath)) return null;

    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
        return {
            filePath,
            parseError: error instanceof Error ? error.message : String(error),
        };
    }
};

const buildRuntimeMetadata = (profile) => ({
    profile,
    commitSha: process.env.GITHUB_SHA || getGitValue(['rev-parse', 'HEAD']),
    branch: process.env.GITHUB_REF_NAME || getGitValue(['branch', '--show-current']),
    nodeVersion: process.version,
    npmUserAgent: process.env.npm_config_user_agent ?? null,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? null,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
});

const buildOutFilePath = ({ suite, profile }) => {
    const stem = suite === 'scenarios' ? 'web-full' : 'web-secondary';
    return `ci-artifacts/hvsc-performance/web/${stem}-${profile}.json`;
};

const buildSummaryMarkdown = (summary) => {
    const lines = [
        `# Web Perf Summary (${summary.profile})`,
        '',
        `- Generated: ${summary.generatedAt}`,
        `- Suite: ${summary.suite}`,
        `- Status: ${summary.status}`,
        `- Mode: ${summary.mode}`,
        `- Evidence class: ${summary.evidenceClass}`,
        `- Loops: ${summary.loops}`,
    ];

    if (summary.limitations?.length) {
        lines.push('');
        summary.limitations.forEach((limitation) => lines.push(`- Limitation: ${limitation}`));
    }

    if (summary.suite === 'scenarios' && summary.scenarioSummaries) {
        lines.push('');
        lines.push('| Scenario | Samples | Mean ms | p75 ms | p95 ms | p99 ms |');
        lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
        Object.entries(summary.scenarioSummaries).forEach(([scenarioName, scenarioSummary]) => {
            lines.push(
                `| ${scenarioName} | ${scenarioSummary.sampleCount ?? 0} | ${scenarioSummary.wallClockMs.mean ?? 'n/a'} | ${scenarioSummary.wallClockMs.p75 ?? 'n/a'} | ${scenarioSummary.wallClockMs.p95 ?? 'n/a'} | ${scenarioSummary.wallClockMs.p99 ?? 'n/a'} |`,
            );
        });
    }

    if (summary.metrics) {
        lines.push('');
        lines.push('| Metric | Samples | Mean ms | p75 ms | p95 ms | p99 ms |');
        lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
        Object.entries(summary.metrics).forEach(([metricName, metricSummary]) => {
            lines.push(
                `| ${metricName} | ${metricSummary.sampleCount ?? 0} | ${metricSummary.mean ?? 'n/a'} | ${metricSummary.p75 ?? 'n/a'} | ${metricSummary.p95 ?? 'n/a'} | ${metricSummary.p99 ?? 'n/a'} |`,
            );
        });
    }

    return `${lines.join('\n')}\n`;
};

const resolveCachedArchive = (candidates) => candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;

const homeCacheDir = path.join(os.homedir(), '.cache', 'c64commander', 'hvsc');
const explicitUpdateCache = process.env.HVSC_UPDATE_84_CACHE;
const explicitUpdateArchive =
    explicitUpdateCache && explicitUpdateCache.endsWith('.7z')
        ? explicitUpdateCache
        : explicitUpdateCache
            ? path.join(explicitUpdateCache, 'HVSC_Update_84.7z')
            : null;

const useRealArchives =
    args.get('--use-real-archives') === '1' || process.env.HVSC_PERF_USE_REAL_ARCHIVES === '1';
const project = args.get('--project') || process.env.HVSC_PERF_PROJECT || 'web';
const suite = args.get('--suite') || process.env.HVSC_PERF_SUITE || 'secondary';
const requestedProfile = args.get('--profile') || process.env.HVSC_PERF_PROFILE || '';
const bytesPerSecond =
    args.get('--bytes-per-second') || process.env.HVSC_PERF_BYTES_PER_SECOND || String(5 * 1024 * 1024);
const tmpDir = path.resolve('.tmp', 'hvsc-perf');
const baselineArchive = useRealArchives
    ? resolveCachedArchive([
        process.env.HVSC_PERF_BASELINE_ARCHIVE,
        process.env.HVSC_ARCHIVE_PATH,
        path.join(homeCacheDir, 'HVSC_84-all-of-them.7z'),
    ])
    : null;
const updateArchive = useRealArchives
    ? resolveCachedArchive([
        process.env.HVSC_PERF_UPDATE_ARCHIVE,
        explicitUpdateArchive,
        path.join(homeCacheDir, 'HVSC_Update_84.7z'),
    ])
    : null;
const runProfile = resolveWebPerfRunProfile({ suite, useRealArchives, profile: requestedProfile });
const loops = Number(args.get('--loops') || process.env.HVSC_PERF_LOOPS || String(runProfile.loops));
const outFile =
    args.get('--out') || process.env.HVSC_PERF_SUMMARY_FILE || buildOutFilePath({ suite, profile: runProfile.profile });
const markdownSummaryFile =
    args.get('--summary') || process.env.HVSC_PERF_HUMAN_SUMMARY_FILE || outFile.replace(/\.json$/, '.md');
const archivePreparation = readJsonIfExists(
    args.get('--archive-preparation') ||
        process.env.HVSC_PERF_ARCHIVE_METADATA_FILE ||
        'ci-artifacts/hvsc-performance/archive-preparation.json',
);
const runtime = buildRuntimeMetadata(runProfile.profile);

if (useRealArchives && (!baselineArchive || !updateArchive)) {
    process.stderr.write(
        'Real archive mode requested, but the cached HVSC baseline/update archives were not both found. ' +
        'Populate ~/.cache/c64commander/hvsc or set HVSC_PERF_BASELINE_ARCHIVE and HVSC_PERF_UPDATE_ARCHIVE.\n',
    );
    process.exit(1);
}

await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });
mkdirSync(path.dirname(outFile), { recursive: true });
mkdirSync(path.dirname(markdownSummaryFile), { recursive: true });

if (!runProfile.supported) {
    const summary = {
        generatedAt: new Date().toISOString(),
        scenario: suite === 'scenarios' ? 'web-hvsc-s1-s11' : 'web-browse-playback-secondary',
        suite,
        profile: runProfile.profile,
        loops,
        project,
        bytesPerSecond: Number(bytesPerSecond),
        mode: runProfile.mode,
        evidenceClass: runProfile.evidenceClass,
        limitations: runProfile.limitations,
        runtime,
        archives: {
            baselineArchive,
            updateArchive,
        },
        archivePreparation,
        status: 'unsupported',
        runnerExitCode: 0,
        ...summarizeScenarioIterations([], { evidenceClass: runProfile.evidenceClass }),
        iterations: [],
    };

    writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');
    writeFileSync(markdownSummaryFile, buildSummaryMarkdown(summary), 'utf8');
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
    profile: runProfile.profile,
    loops,
    project,
    bytesPerSecond: Number(bytesPerSecond),
    mode: runProfile.mode,
    evidenceClass: runProfile.evidenceClass,
    limitations: runProfile.limitations,
    runtime,
    archives: {
        baselineArchive,
        updateArchive,
    },
    archivePreparation,
    status: overallExitCode === 0 ? 'passed' : 'failed',
    runnerExitCode: overallExitCode,
    ...suiteSummary,
    iterations,
};

writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');
writeFileSync(markdownSummaryFile, buildSummaryMarkdown(summary), 'utf8');
process.stdout.write(`${path.resolve(outFile)}\n`);
if (overallExitCode !== 0) {
    process.exit(overallExitCode);
}
