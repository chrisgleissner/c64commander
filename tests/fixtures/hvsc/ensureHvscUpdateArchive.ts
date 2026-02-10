/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Shared test utility: ensures the real HVSC_Update_84.7z archive is available locally.
 *
 * Resolution order:
 * 1. $HVSC_UPDATE_84_CACHE (explicit cache path)
 * 2. ~/.cache/c64commander/hvsc/HVSC_Update_84.7z
 * 3. Downloaded from https://hvsc.brona.dk/HVSC/HVSC_Update_84.7z (first time only)
 *
 * The real archive is NEVER committed to git (.gitignore covers it).
 * CI caches it via actions/cache@v4 with key `hvsc-update-84-<runner.os>`.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_UPDATE_URL = 'https://hvsc.brona.dk/HVSC/HVSC_Update_84.7z';
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.cache', 'c64commander', 'hvsc');
const LOCAL_MOCK_FIXTURE_PATH = path.resolve('android/app/src/test/fixtures/HVSC_Update_mock.7z');

const downloadViaHttps = async (url: string, targetPath: string) => {
    const { request } = await import('node:https');
    await new Promise<void>((resolve, reject) => {
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

const downloadViaFetch = async (url: string, targetPath: string) => {
    if (typeof fetch !== 'function') {
        return downloadViaHttps(url, targetPath);
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, new Uint8Array(arrayBuffer));
};

/**
 * Returns the path to a real (or mock) HVSC update .7z archive.
 * Downloads once from hvsc.brona.dk if not yet cached.
 */
export const ensureHvscUpdateArchive = async (): Promise<string> => {
    const cacheDir = process.env.HVSC_UPDATE_84_CACHE ?? DEFAULT_CACHE_DIR;
    const archiveName = 'HVSC_Update_84.7z';
    const archivePath = path.join(cacheDir, archiveName);
    if (!existsSync(archivePath)) {
        await mkdir(cacheDir, { recursive: true });
        const url = process.env.HVSC_UPDATE_84_URL ?? DEFAULT_UPDATE_URL;
        await downloadViaFetch(url, archivePath);
    }
    return archivePath;
};

/**
 * Returns the archive as a Uint8Array buffer. Uses the same resolution logic as ensureHvscUpdateArchive.
 */
export const loadHvscUpdateArchiveBuffer = async (): Promise<Uint8Array> => {
    const archivePath = await ensureHvscUpdateArchive();
    return new Uint8Array(await readFile(archivePath));
};

/**
 * Returns the mock archive as a Uint8Array buffer (no network).
 */
export const loadHvscUpdateMockArchiveBuffer = async (): Promise<Uint8Array> => {
    return new Uint8Array(await readFile(LOCAL_MOCK_FIXTURE_PATH));
};

/**
 * Returns true if the mock fixture exists (no network needed).
 */
export const hasMockFixture = () => existsSync(LOCAL_MOCK_FIXTURE_PATH);

/**
 * Returns the mock fixture path (for tests that specifically want the mock).
 */
export const getMockFixturePath = () => LOCAL_MOCK_FIXTURE_PATH;
