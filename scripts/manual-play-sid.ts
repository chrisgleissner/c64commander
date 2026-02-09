/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const createMemoryStorage = () => {
    const store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        clear() {
            store.clear();
        },
        getItem(key: string) {
            return store.has(key) ? store.get(key) ?? null : null;
        },
        key(index: number) {
            return Array.from(store.keys())[index] ?? null;
        },
        removeItem(key: string) {
            store.delete(key);
        },
        setItem(key: string, value: string) {
            store.set(key, value);
        },
    };
};

const ensureBrowserShims = () => {
    if (typeof window === 'undefined') {
        (globalThis as typeof globalThis & { window?: unknown }).window = globalThis;
    }
    if (typeof localStorage === 'undefined') {
        (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = createMemoryStorage() as Storage;
    }
    if (typeof sessionStorage === 'undefined') {
        (globalThis as typeof globalThis & { sessionStorage?: Storage }).sessionStorage = createMemoryStorage() as Storage;
    }
    if (typeof navigator === 'undefined') {
        (globalThis as typeof globalThis & { navigator?: Navigator }).navigator = { userAgent: 'node' } as Navigator;
    }
    if (typeof CustomEvent === 'undefined') {
        class CustomEventShim<T = unknown> extends Event {
            detail: T;
            constructor(type: string, init?: CustomEventInit<T>) {
                super(type, init);
                this.detail = (init?.detail ?? null) as T;
            }
        }
        (globalThis as typeof globalThis & { CustomEvent?: typeof CustomEventShim }).CustomEvent = CustomEventShim;
    }
    if (typeof window.addEventListener !== 'function') {
        (window as typeof window & { addEventListener?: () => void }).addEventListener = () => { };
    }
    if (typeof window.removeEventListener !== 'function') {
        (window as typeof window & { removeEventListener?: () => void }).removeEventListener = () => { };
    }
    if (typeof window.dispatchEvent !== 'function') {
        (window as typeof window & { dispatchEvent?: () => boolean }).dispatchEvent = () => true;
    }
};

const parseArgs = (argv: string[]) => {
    const args = [...argv];
    const filePath = args.shift();
    if (!filePath) {
        throw new Error('Usage: manual-play-sid.sh /path/to/song.sid [--song 1] [--duration-ms 180000]');
    }

    let songNr: number | undefined;
    let durationMs: number | undefined;

    while (args.length > 0) {
        const flag = args.shift();
        if (!flag) break;
        if (flag === '--song') {
            const value = args.shift();
            if (!value) throw new Error('Missing value for --song');
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 1) {
                throw new Error(`Invalid --song value: ${value}`);
            }
            songNr = Math.floor(parsed);
            continue;
        }
        if (flag === '--duration-ms') {
            const value = args.shift();
            if (!value) throw new Error('Missing value for --duration-ms');
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(`Invalid --duration-ms value: ${value}`);
            }
            durationMs = Math.floor(parsed);
            continue;
        }
        throw new Error(`Unknown argument: ${flag}`);
    }

    return { filePath, songNr, durationMs };
};

const resolveEnvNumber = (value?: string) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const main = async () => {
    ensureBrowserShims();

    const { filePath, songNr, durationMs } = parseArgs(process.argv.slice(2));
    const resolvedPath = path.resolve(filePath);

    const buffer = await fs.readFile(resolvedPath);
    const sidBlob = new Blob([buffer], { type: 'audio/sid' });
    (sidBlob as Blob & { name?: string }).name = path.basename(resolvedPath);

    const envSongNr = resolveEnvNumber(process.env.C64U_SONGNR);
    const envDurationMs = resolveEnvNumber(process.env.C64U_DURATION_MS);

    const host = process.env.C64U_HOST || process.env.C64U_DEVICE_HOST || 'c64u';
    const baseUrl = process.env.C64U_BASE_URL || undefined;
    const password = process.env.C64U_PASSWORD || undefined;

    const { buildBaseUrlFromDeviceHost, C64API } = await import('@/lib/c64api');
    const { buildPlayPlan, executePlayPlan } = await import('@/lib/playback/playbackRouter');
    const { updateDeviceConnectionState } = await import('@/lib/deviceInteraction/deviceStateStore');

    updateDeviceConnectionState('REAL_CONNECTED');

    const api = new C64API(baseUrl ?? buildBaseUrlFromDeviceHost(host), password, host);
    const plan = buildPlayPlan({
        source: 'local',
        path: resolvedPath,
        file: sidBlob,
        songNr: songNr ?? envSongNr,
        durationMs: durationMs ?? envDurationMs,
    });

    await executePlayPlan(api, plan);
    console.log('SID upload requested. Check the C64U for playback.');
};

main().catch((error) => {
    console.error('SID playback failed:', (error as Error).message || error);
    process.exitCode = 1;
});
