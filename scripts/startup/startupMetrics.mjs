import { readFileSync } from 'node:fs';

const STARTUP_CONFIG_PREFIX = '/v1/configs/';
const HVSC_DOWNLOAD_MARKERS = [
    'download hvsc',
    '/hvsc/',
    'hvsc_update',
    'hvsc-baseline',
    'hvsc-update',
    '/hvsc/update',
];

const quantile = (values, q) => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
    return sorted[position];
};

const extractUrl = (line) => {
    const match = line.match(/https?:\/\/[^\s"']+/i);
    if (!match) return null;
    const url = match[0];
    const pathMatch = url.match(/^https?:\/\/[^/]+(\/[^\s"']*)?/i);
    return pathMatch?.[1] ?? '/';
};

const extractLatencyMs = (line) => {
    const latencyMatch = line.match(/(\d+)\s*ms/i);
    if (!latencyMatch) return null;
    const value = Number(latencyMatch[1]);
    return Number.isFinite(value) ? value : null;
};

const isUserCommandPath = (path) => path === '/v1/machine:reset' || path === '/v1/machine:reboot';

export const parseStartupMetricsFromLines = (lines) => {
    let startupRequestCount = 0;
    let startupConfigCalls = 0;
    let duplicateStartupConfigKeyRequests = 0;
    let startupBacklogDepth = 0;
    let inFlight = 0;
    let nullStringWarnings = 0;
    let hvscStartupDownloads = 0;
    let startupWindowOpen = true;

    const configRequestCounts = new Map();
    const userLatencySamples = [];

    for (const line of lines) {
        const lowered = line.toLowerCase();
        if (lowered.includes('capacitor: app resumed') || lowered.includes('capacitor: app started')) {
            startupWindowOpen = false;
        }
        if (lowered.includes('convertjavastringtoutf8 called with null string')) {
            nullStringWarnings += 1;
        }

        const looksLikeRequest = startupWindowOpen
            && (lowered.includes('capacitorhttp') || lowered.includes('c64 api request') || lowered.includes('fetch('));
        if (looksLikeRequest) {
            const path = extractUrl(line) ?? '';
            if (path) {
                startupRequestCount += 1;
                inFlight += 1;
                startupBacklogDepth = Math.max(startupBacklogDepth, inFlight);
                if (path.startsWith(STARTUP_CONFIG_PREFIX)) {
                    startupConfigCalls += 1;
                    const key = path.slice(STARTUP_CONFIG_PREFIX.length);
                    const seen = (configRequestCounts.get(key) ?? 0) + 1;
                    configRequestCounts.set(key, seen);
                    if (seen > 1) {
                        duplicateStartupConfigKeyRequests += 1;
                    }
                }
                if (isUserCommandPath(path)) {
                    const latency = extractLatencyMs(line);
                    if (latency !== null) {
                        userLatencySamples.push(latency);
                    }
                }
            }
        }

        if (lowered.includes('response') || lowered.includes('status') || lowered.includes('c64 api request')) {
            inFlight = Math.max(0, inFlight - 1);
        }

        if (HVSC_DOWNLOAD_MARKERS.some((marker) => lowered.includes(marker))) {
            hvscStartupDownloads += 1;
        }
    }

    return {
        StartupRequestCount: startupRequestCount,
        StartupConfigCalls: startupConfigCalls,
        DuplicateStartupConfigKeyRequests: duplicateStartupConfigKeyRequests,
        StartupBacklogDepth: startupBacklogDepth,
        NullStringWarningCount: nullStringWarnings,
        HvscStartupDownloads: hvscStartupDownloads,
        UserTriggeredCommandLatencyMs: {
            samples: userLatencySamples,
            p50: quantile(userLatencySamples, 0.5),
            p95: quantile(userLatencySamples, 0.95),
        },
    };
};

export const parseStartupMetricsFromFile = (filePath) => {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return parseStartupMetricsFromLines(lines);
};

export const summarizeTtfsc = (ttfscSamples) => ({
    samples: ttfscSamples,
    p50: quantile(ttfscSamples, 0.5),
    p95: quantile(ttfscSamples, 0.95),
});
