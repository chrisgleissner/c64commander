import type { Page } from '@playwright/test';
import type { TraceEvent } from '../src/lib/tracing/types';

export const FIXED_NOW_ISO = '2024-03-20T12:34:56.000Z';
export const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

export const DISK_LIBRARY_SEED = [
    {
        id: 'ultimate:/Usb0/Games/Turrican II/Disk 1.d64',
        name: 'Disk 1.d64',
        path: '/Usb0/Games/Turrican II/Disk 1.d64',
        location: 'ultimate',
        group: 'Turrican II',
        sizeBytes: 174848,
        modifiedAt: '2024-03-10T10:00:00.000Z',
        importedAt: '2024-03-12T09:00:00.000Z',
        importOrder: 1,
    },
    {
        id: 'ultimate:/Usb0/Games/Turrican II/Disk 2.d64',
        name: 'Disk 2.d64',
        path: '/Usb0/Games/Turrican II/Disk 2.d64',
        location: 'ultimate',
        group: 'Turrican II',
        sizeBytes: 174848,
        modifiedAt: '2024-03-10T10:05:00.000Z',
        importedAt: '2024-03-12T09:01:00.000Z',
        importOrder: 2,
    },
    {
        id: 'ultimate:/Usb0/Games/Turrican II/Disk 3.d64',
        name: 'Disk 3.d64',
        path: '/Usb0/Games/Turrican II/Disk 3.d64',
        location: 'ultimate',
        group: 'Turrican II',
        sizeBytes: 174848,
        modifiedAt: '2024-03-10T10:10:00.000Z',
        importedAt: '2024-03-12T09:02:00.000Z',
        importOrder: 3,
    },
    {
        id: 'ultimate:/Usb0/Games/Last Ninja/Disk 1.d64',
        name: 'Disk 1.d64',
        path: '/Usb0/Games/Last Ninja/Disk 1.d64',
        location: 'ultimate',
        group: 'Last Ninja',
        sizeBytes: 174848,
        modifiedAt: '2024-03-11T08:15:00.000Z',
        importedAt: '2024-03-12T09:03:00.000Z',
        importOrder: 1,
    },
    {
        id: 'local:/Local/Disks/Defender of the Crown.d64',
        name: 'Defender of the Crown.d64',
        path: '/Local/Disks/Defender of the Crown.d64',
        location: 'local',
        group: null,
        sizeBytes: 174848,
        modifiedAt: '2024-03-11T09:00:00.000Z',
        importedAt: '2024-03-12T09:04:00.000Z',
        importOrder: 4,
    },
    {
        id: 'local:/Local/Disks/Great Giana Sisters.d64',
        name: 'Great Giana Sisters.d64',
        path: '/Local/Disks/Great Giana Sisters.d64',
        location: 'local',
        group: null,
        sizeBytes: 174848,
        modifiedAt: '2024-03-11T09:30:00.000Z',
        importedAt: '2024-03-12T09:05:00.000Z',
        importOrder: 5,
    },
];

export const PLAYLIST_SEED = {
    items: [
        {
            source: 'local',
            path: '/Local/Demos/intro.sid',
            name: 'intro.sid',
            durationMs: 185000,
            sizeBytes: 32145,
            modifiedAt: '2024-03-18T09:12:00.000Z',
            addedAt: '2024-03-18T09:30:00.000Z',
        },
        {
            source: 'local',
            path: '/Local/Demos/scene.mod',
            name: 'scene.mod',
            durationMs: 210000,
            sizeBytes: 54231,
            modifiedAt: '2024-03-18T10:15:00.000Z',
            addedAt: '2024-03-18T10:20:00.000Z',
        },
        {
            source: 'local',
            path: '/Local/Tools/fastload.prg',
            name: 'fastload.prg',
            durationMs: 60000,
            sizeBytes: 1048,
            modifiedAt: '2024-03-18T11:00:00.000Z',
            addedAt: '2024-03-18T11:05:00.000Z',
        },
        {
            source: 'ultimate',
            path: '/Usb0/Games/SpaceTaxi.d64',
            name: 'SpaceTaxi.d64',
            durationMs: 300000,
            sizeBytes: 174848,
            modifiedAt: '2024-03-19T08:05:00.000Z',
            addedAt: '2024-03-19T08:10:00.000Z',
        },
        {
            source: 'ultimate',
            path: '/Usb0/Cartridges/ActionReplay.crt',
            name: 'ActionReplay.crt',
            durationMs: 120000,
            sizeBytes: 65536,
            modifiedAt: '2024-03-19T09:00:00.000Z',
            addedAt: '2024-03-19T09:05:00.000Z',
        },
    ],
    currentIndex: 1,
};

export const LOG_SEED = [
    {
        id: 'log-1',
        level: 'info',
        message: 'Config refresh complete',
        timestamp: '2024-03-20T11:58:20.000Z',
        details: { endpoint: '/v1/configs', durationMs: 180 },
    },
    {
        id: 'log-2',
        level: 'warn',
        message: 'Background probe slow',
        timestamp: '2024-03-20T11:59:10.000Z',
        details: { timeoutMs: 1200 },
    },
    {
        id: 'log-3',
        level: 'error',
        message: 'Disk mount failed',
        timestamp: '2024-03-20T12:00:05.000Z',
        details: { drive: 'A', reason: 'Disk not found' },
    },
];

export const TRACE_SEED: TraceEvent[] = [
    {
        id: 'TRACE-1000',
        timestamp: '2024-03-20T12:00:00.000Z',
        relativeMs: 0,
        type: 'action-start',
        origin: 'user',
        correlationId: 'COR-1000',
        data: { name: 'playlist.add' },
    },
    {
        id: 'TRACE-1001',
        timestamp: '2024-03-20T12:00:00.050Z',
        relativeMs: 50,
        type: 'rest-request',
        origin: 'user',
        correlationId: 'COR-1000',
        data: { method: 'GET', url: '/v1/info', normalizedUrl: '/v1/info', target: 'real-device' },
    },
    {
        id: 'TRACE-1002',
        timestamp: '2024-03-20T12:00:00.120Z',
        relativeMs: 120,
        type: 'rest-response',
        origin: 'user',
        correlationId: 'COR-1000',
        data: { status: 200, durationMs: 70, error: null },
    },
    {
        id: 'TRACE-1003',
        timestamp: '2024-03-20T12:00:00.220Z',
        relativeMs: 220,
        type: 'ftp-operation',
        origin: 'user',
        correlationId: 'COR-1000',
        data: { operation: 'list', path: '/Usb0', result: 'success', target: 'real-device' },
    },
    {
        id: 'TRACE-1004',
        timestamp: '2024-03-20T12:00:00.260Z',
        relativeMs: 260,
        type: 'error',
        origin: 'user',
        correlationId: 'COR-1000',
        data: { name: 'Error', message: 'Packet timeout' },
    },
    {
        id: 'TRACE-1005',
        timestamp: '2024-03-20T12:00:00.320Z',
        relativeMs: 320,
        type: 'action-end',
        origin: 'user',
        correlationId: 'COR-1000',
        data: { status: 'success', error: null },
    },
];

export const HVSC_STATUS_SUMMARY = {
    download: { status: 'idle' },
    extraction: { status: 'idle' },
    lastUpdatedAt: null,
};

export const installFixedClock = async (page: Page) => {
    await page.addInitScript(({ nowMs }) => {
        const OriginalDate = Date;
        class FixedDate extends OriginalDate {
            constructor(...args: ConstructorParameters<DateConstructor>) {
                if (args.length === 0) {
                    super(nowMs);
                } else {
                    super(...args);
                }
            }
            static now() {
                return nowMs;
            }
        }
        FixedDate.UTC = OriginalDate.UTC;
        FixedDate.parse = OriginalDate.parse;
        window.Date = FixedDate as DateConstructor;
    }, { nowMs: FIXED_NOW_MS });
};

export const installStableStorage = async (page: Page) => {
    await page.addInitScript(
        ({ playlist, disks, logs, hvscSummary, fixedNowIso }) => {
            localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(playlist));
            localStorage.setItem('c64u_playlist:v1:default', JSON.stringify(playlist));
            localStorage.setItem('c64u_last_device_id', 'TEST-123');
            localStorage.setItem('c64u_disk_library:TEST-123', JSON.stringify({ disks }));
            localStorage.setItem('c64u_app_logs', JSON.stringify(logs));
            localStorage.setItem('c64u_hvsc_status:v1', JSON.stringify(hvscSummary));
            localStorage.setItem('c64u_feature_flag:hvsc_enabled', '1');
            sessionStorage.setItem('c64u_feature_flag:hvsc_enabled', '1');
            localStorage.setItem('c64u_demo_clock', fixedNowIso);
        },
        {
            playlist: PLAYLIST_SEED,
            disks: DISK_LIBRARY_SEED,
            logs: LOG_SEED,
            hvscSummary: HVSC_STATUS_SUMMARY,
            fixedNowIso: FIXED_NOW_ISO,
        },
    );
};

export const installLocalSourceSeed = async (page: Page) => {
    await page.addInitScript(() => {
        localStorage.setItem('c64u_local_sources:v1', JSON.stringify([
            {
                id: 'seed-local-source',
                name: 'Seed Local',
                rootName: 'Local',
                rootPath: '/Local/',
                createdAt: '2024-03-20T12:00:00.000Z',
                entries: [
                    {
                        name: 'seed.sid',
                        relativePath: 'Local/seed.sid',
                        sizeBytes: 1024,
                        modifiedAt: '2024-03-20T12:00:00.000Z',
                    },
                ],
            },
        ]));
    });
};

export const installListPreviewLimit = async (page: Page, limit: number) => {
    await page.addInitScript(({ listLimit }) => {
        localStorage.setItem('c64u_list_preview_limit', String(listLimit));
    }, { listLimit: limit });
};

export const seedDiagnosticsTraces = async (page: Page) => {
    await page.evaluate((seed) => {
        const tracing = (window as Window & { __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void } }).__c64uTracing;
        tracing?.seedTraces?.(seed as TraceEvent[]);
    }, TRACE_SEED);
};
