import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_BASELINE_ARCHIVE_NAME = 'HVSC_84-all-of-them.7z';
const DEFAULT_UPDATE_ARCHIVE_NAME = 'HVSC_Update_84.7z';
const DEFAULT_BASELINE_ARCHIVE_URL = 'https://hvsc.sannic.nl/HVSC%2084/HVSC_84-all-of-them.7z';
const DEFAULT_UPDATE_ARCHIVE_URL = 'https://hvsc.brona.dk/HVSC/HVSC_Update_84.7z';

const defaultHomeCacheDir = path.join(os.homedir(), '.cache', 'c64commander', 'hvsc');

export const resolveCachedArchive = (candidates) => candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;

const resolveExplicitUpdateArchive = (explicitUpdateCache) =>
    explicitUpdateCache && explicitUpdateCache.endsWith('.7z')
        ? explicitUpdateCache
        : explicitUpdateCache
            ? path.join(explicitUpdateCache, DEFAULT_UPDATE_ARCHIVE_NAME)
            : null;

const resolveArchiveCacheDir = ({ env, homeCacheDir = defaultHomeCacheDir }) => {
    if (env.HVSC_UPDATE_84_CACHE && !env.HVSC_UPDATE_84_CACHE.endsWith('.7z')) {
        return env.HVSC_UPDATE_84_CACHE;
    }
    if (env.HVSC_ARCHIVE_PATH) {
        return path.dirname(env.HVSC_ARCHIVE_PATH);
    }
    if (env.HVSC_PERF_BASELINE_ARCHIVE) {
        return path.dirname(env.HVSC_PERF_BASELINE_ARCHIVE);
    }
    if (env.HVSC_PERF_UPDATE_ARCHIVE) {
        return path.dirname(env.HVSC_PERF_UPDATE_ARCHIVE);
    }
    return homeCacheDir;
};

const downloadViaHttps = async (url, targetPath) => {
    const { request } = await import('node:https');
    await new Promise((resolve, reject) => {
        const fileStream = createWriteStream(targetPath);
        const req = request(url, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`Failed to download ${url}: ${res.statusCode} ${res.statusMessage}`));
                return;
            }
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });
        });
        req.on('error', reject);
        req.end();
    });
};

const downloadViaFetch = async (url, targetPath) => {
    if (typeof fetch !== 'function') {
        return downloadViaHttps(url, targetPath);
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(targetPath, new Uint8Array(arrayBuffer));
};

export const ensureRealArchivePair = async ({
    env = process.env,
    homeCacheDir = defaultHomeCacheDir,
    downloadArchive = downloadViaFetch,
} = {}) => {
    const cacheDir = resolveArchiveCacheDir({ env, homeCacheDir });
    const explicitUpdateArchive = resolveExplicitUpdateArchive(env.HVSC_UPDATE_84_CACHE);
    let baselineArchive = resolveCachedArchive([
        env.HVSC_PERF_BASELINE_ARCHIVE,
        env.HVSC_ARCHIVE_PATH,
        path.join(cacheDir, DEFAULT_BASELINE_ARCHIVE_NAME),
        path.join(homeCacheDir, DEFAULT_BASELINE_ARCHIVE_NAME),
    ]);
    let updateArchive = resolveCachedArchive([
        env.HVSC_PERF_UPDATE_ARCHIVE,
        explicitUpdateArchive,
        path.join(cacheDir, DEFAULT_UPDATE_ARCHIVE_NAME),
        path.join(homeCacheDir, DEFAULT_UPDATE_ARCHIVE_NAME),
    ]);

    if (baselineArchive && updateArchive) {
        return { baselineArchive, updateArchive, cacheDir, downloaded: false };
    }

    await mkdir(cacheDir, { recursive: true });

    if (!baselineArchive) {
        const targetPath = env.HVSC_ARCHIVE_PATH || path.join(cacheDir, DEFAULT_BASELINE_ARCHIVE_NAME);
        const url = env.HVSC_PERF_BASELINE_ARCHIVE_URL || DEFAULT_BASELINE_ARCHIVE_URL;
        await downloadArchive(url, targetPath);
        baselineArchive = targetPath;
    }

    if (!updateArchive) {
        const targetPath = explicitUpdateArchive || env.HVSC_PERF_UPDATE_ARCHIVE || path.join(cacheDir, DEFAULT_UPDATE_ARCHIVE_NAME);
        const url = env.HVSC_PERF_UPDATE_ARCHIVE_URL || env.HVSC_UPDATE_84_URL || DEFAULT_UPDATE_ARCHIVE_URL;
        await downloadArchive(url, targetPath);
        updateArchive = targetPath;
    }

    return { baselineArchive, updateArchive, cacheDir, downloaded: true };
};