#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const quantile = (values, q) => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
    return sorted[position];
};

const summarizeMetric = (samples) => ({
    samples,
    min: samples.length ? Math.min(...samples) : null,
    max: samples.length ? Math.max(...samples) : null,
    p50: quantile(samples, 0.5),
    p95: quantile(samples, 0.95),
});

const args = new Map(
    process.argv.slice(2).map((arg) => {
        const [key, value] = arg.split('=');
        return [key, value ?? ''];
    }),
);

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
const loops = Number(args.get('--loops') || process.env.HVSC_PERF_LOOPS || '3');
const project = args.get('--project') || process.env.HVSC_PERF_PROJECT || 'web';
const bytesPerSecond =
    args.get('--bytes-per-second') || process.env.HVSC_PERF_BYTES_PER_SECOND || String(5 * 1024 * 1024);
const outFile =
    args.get('--out') || process.env.HVSC_PERF_SUMMARY_FILE || 'ci-artifacts/hvsc-performance/web-secondary.json';
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

const iterations = [];
for (let index = 0; index < loops; index += 1) {
    const rawFile = path.join(tmpDir, `loop-${String(index + 1).padStart(2, '0')}.json`);
    const result = spawnSync(
        'npx',
        ['playwright', 'test', 'playwright/hvscPerf.spec.ts', '--project', project, '--reporter=line'],
        {
            stdio: 'inherit',
            env: {
                ...process.env,
                HVSC_PERF_OUTPUT_FILE: rawFile,
                HVSC_PERF_BYTES_PER_SECOND: bytesPerSecond,
                HVSC_PERF_BASELINE_ARCHIVE: baselineArchive ?? '',
                HVSC_PERF_UPDATE_ARCHIVE: updateArchive ?? '',
                PLAYWRIGHT_DEVICES: 'web',
            },
        },
    );
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
    iterations.push(JSON.parse(readFileSync(rawFile, 'utf8')));
}

const metricNames = ['browseLoadSnapshotMs', 'browseInitialQueryMs', 'browseSearchQueryMs', 'playbackLoadSidMs'];
const metrics = Object.fromEntries(
    metricNames.map((name) => {
        const samples = iterations
            .map((iteration) => iteration.metrics?.[name])
            .filter((value) => Number.isFinite(value));
        return [name, summarizeMetric(samples)];
    }),
);

const summary = {
    generatedAt: new Date().toISOString(),
    scenario: 'web-browse-playback-secondary',
    loops,
    project,
    bytesPerSecond: Number(bytesPerSecond),
    mode: useRealArchives ? 'real-archive-secondary-web' : 'fixture-secondary-web',
    archives: {
        baselineArchive,
        updateArchive,
    },
    metrics,
    iterations,
};

writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');
process.stdout.write(`${path.resolve(outFile)}\n`);
