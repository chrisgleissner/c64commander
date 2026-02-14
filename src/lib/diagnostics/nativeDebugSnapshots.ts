import { addErrorLog, getErrorLogs, getLogs } from '@/lib/logging';
import { buildActionSummaries } from '@/lib/diagnostics/actionSummaries';
import { getTraceEvents } from '@/lib/tracing/traceSession';
import { getPlatform } from '@/lib/native/platform';
import { pushNativeDebugSnapshots } from '@/lib/native/diagnosticsBridge';

type SnapshotPayload = {
    trace: string;
    actions: string;
    log: string;
    errorLog: string;
};

const sortObjectKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map((entry) => sortObjectKeys(entry));
    }
    if (value && typeof value === 'object') {
        const normalized: Record<string, unknown> = {};
        Object.keys(value as Record<string, unknown>)
            .sort((left, right) => left.localeCompare(right))
            .forEach((key) => {
                normalized[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
            });
        return normalized;
    }
    return value;
};

const stableStringify = (value: unknown) => JSON.stringify(sortObjectKeys(value), null, 2);

const sortLogEntries = <T extends { id?: string; timestamp?: string }>(entries: T[]) =>
    [...entries].sort((left, right) => {
        const leftTimestamp = left.timestamp ?? '';
        const rightTimestamp = right.timestamp ?? '';
        if (leftTimestamp !== rightTimestamp) {
            return leftTimestamp.localeCompare(rightTimestamp);
        }
        return (left.id ?? '').localeCompare(right.id ?? '');
    });

const buildSnapshotPayload = (): SnapshotPayload => {
    const traceEvents = getTraceEvents();
    const actionSummaries = buildActionSummaries(traceEvents);
    const logs = sortLogEntries(getLogs());
    const errorLogs = sortLogEntries(getErrorLogs());

    return {
        trace: stableStringify(traceEvents),
        actions: stableStringify(actionSummaries),
        log: stableStringify(logs),
        errorLog: stableStringify(errorLogs),
    };
};

let isRunning = false;
let timerId: number | null = null;

const schedule = () => {
    if (timerId !== null) return;
    timerId = window.setTimeout(() => {
        timerId = null;
        void publishSnapshots();
    }, 120);
};

const publishSnapshots = async () => {
    try {
        await pushNativeDebugSnapshots(buildSnapshotPayload());
    } catch (error) {
        addErrorLog('Native debug snapshot publish failed', {
            error: (error as Error).message,
        });
    }
};

export const startNativeDebugSnapshotPublisher = () => {
    if (isRunning) {
        return () => undefined;
    }
    if (typeof window === 'undefined') {
        return () => undefined;
    }
    if (getPlatform() !== 'ios') {
        return () => undefined;
    }

    isRunning = true;

    const handleTracesUpdated = () => schedule();
    const handleLogsUpdated = () => schedule();

    window.addEventListener('c64u-traces-updated', handleTracesUpdated);
    window.addEventListener('c64u-logs-updated', handleLogsUpdated);
    void publishSnapshots();

    return () => {
        if (!isRunning) return;
        isRunning = false;
        if (timerId !== null) {
            window.clearTimeout(timerId);
            timerId = null;
        }
        window.removeEventListener('c64u-traces-updated', handleTracesUpdated);
        window.removeEventListener('c64u-logs-updated', handleLogsUpdated);
    };
};
