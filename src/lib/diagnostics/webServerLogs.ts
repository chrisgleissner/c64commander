import { addLog, setExternalLogs, type LogEntry, type LogLevel } from '@/lib/logging';

type ServerLogEntry = {
    id: string;
    timestamp: string;
    level: LogLevel;
    message: string;
    details?: unknown;
};

type ServerLogsPayload = {
    logs?: ServerLogEntry[];
};

const POLL_INTERVAL_MS = 5000;

const isWebPlatformServerMode = () => import.meta.env.VITE_WEB_PLATFORM === '1';

const normalizeLogs = (logs: ServerLogEntry[]): LogEntry[] =>
    logs
        .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.timestamp === 'string')
        .map((entry) => ({
            id: `server-${entry.id}`,
            level: entry.level,
            message: entry.message,
            timestamp: entry.timestamp,
            details: entry.details,
        }));

export const startWebServerLogBridge = () => {
    if (typeof window === 'undefined') return () => { };
    if (!isWebPlatformServerMode()) return () => { };

    let disposed = false;
    let timer: number | null = null;
    let lastPollErrorAtMs = 0;

    const poll = async () => {
        if (disposed) return;
        try {
            const response = await fetch('/api/diagnostics/server-logs', {
                method: 'GET',
                credentials: 'same-origin',
            });
            if (response.status === 401) {
                setExternalLogs([]);
            } else if (response.ok) {
                const payload = (await response.json()) as ServerLogsPayload;
                setExternalLogs(normalizeLogs(payload.logs ?? []));
            }
        } catch (error) {
            const now = Date.now();
            if (now - lastPollErrorAtMs > 60_000) {
                addLog('warn', 'Web server log bridge poll failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
                lastPollErrorAtMs = now;
            }
        } finally {
            if (!disposed) {
                timer = window.setTimeout(() => {
                    void poll();
                }, POLL_INTERVAL_MS);
            }
        }
    };

    void poll();

    return () => {
        disposed = true;
        if (timer !== null) {
            window.clearTimeout(timer);
        }
        setExternalLogs([]);
    };
};
