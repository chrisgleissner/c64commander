#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ensureRealArchivePair } from './realArchiveCache.mjs';

const args = new Map(
    process.argv.slice(2).map((arg) => {
        const [key, value] = arg.split('=');
        return [key, value ?? ''];
    }),
);

const outFile =
    args.get('--out') || process.env.HVSC_PERF_ARCHIVE_METADATA_FILE || 'ci-artifacts/hvsc-performance/archive-preparation.json';
const envFile = args.get('--write-env') || '';

const hashFile = async (filePath) =>
    await new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });

const resolveHashCachePath = (filePath) => `${filePath}.sha256`;

const readPersistedHash = (filePath) => {
    const hashCachePath = resolveHashCachePath(filePath);
    if (!existsSync(hashCachePath)) {
        return null;
    }

    const value = readFileSync(hashCachePath, 'utf8').trim();
    return value.length === 64 ? value : null;
};

const persistHash = (filePath, sha256) => {
    writeFileSync(resolveHashCachePath(filePath), `${sha256}\n`, 'utf8');
};

const buildArchiveIdentity = async (filePath, { refreshHash }) => {
    const fileStat = await stat(filePath);
    const persistedHash = !refreshHash ? readPersistedHash(filePath) : null;
    const sha256 = persistedHash ?? (await hashFile(filePath));

    if (!persistedHash) {
        persistHash(filePath, sha256);
    }

    return {
        path: filePath,
        sizeBytes: fileStat.size,
        sha256,
    };
};

const appendEnvFile = (filePath, values) => {
    const content = Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    writeFileSync(filePath, `${content}\n`, { encoding: 'utf8', flag: 'a' });
};

const { baselineArchive, updateArchive, cacheDir, downloaded } = await ensureRealArchivePair();
mkdirSync(path.dirname(outFile), { recursive: true });

const summary = {
    generatedAt: new Date().toISOString(),
    downloaded,
    cacheDir,
    overrideVariables: {
        baselineArchive: 'HVSC_PERF_BASELINE_ARCHIVE',
        updateArchive: 'HVSC_PERF_UPDATE_ARCHIVE',
        baselineUrl: 'HVSC_PERF_BASELINE_ARCHIVE_URL',
        updateUrl: 'HVSC_PERF_UPDATE_ARCHIVE_URL',
        legacyBaselineArchive: 'HVSC_ARCHIVE_PATH',
        legacyUpdateCache: 'HVSC_UPDATE_84_CACHE',
    },
    archiveUrls: {
        baseline: process.env.HVSC_PERF_BASELINE_ARCHIVE_URL || 'https://hvsc.sannic.nl/HVSC%2084/HVSC_84-all-of-them.7z',
        update:
            process.env.HVSC_PERF_UPDATE_ARCHIVE_URL ||
            process.env.HVSC_UPDATE_84_URL ||
            'https://hvsc.brona.dk/HVSC/HVSC_Update_84.7z',
    },
    archives: {
        baseline: await buildArchiveIdentity(baselineArchive, { refreshHash: downloaded }),
        update: await buildArchiveIdentity(updateArchive, { refreshHash: downloaded }),
    },
};

writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');

if (envFile) {
    appendEnvFile(envFile, {
        HVSC_PERF_BASELINE_ARCHIVE: baselineArchive,
        HVSC_PERF_UPDATE_ARCHIVE: updateArchive,
        HVSC_ARCHIVE_PATH: baselineArchive,
        HVSC_UPDATE_84_CACHE: cacheDir,
        HVSC_PERF_ARCHIVE_CACHE_DIR: cacheDir,
        HVSC_PERF_ARCHIVE_METADATA_FILE: path.resolve(outFile),
    });
}

process.stdout.write(`${path.resolve(outFile)}\n`);
