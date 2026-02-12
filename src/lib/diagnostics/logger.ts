import { addLog, type LogLevel } from '@/lib/logging';
import { getActiveAction } from '@/lib/tracing/actionTrace';
import { getPlaybackTraceSnapshot } from '@/pages/playFiles/playbackTraceStore';

type LoggerDetails = Record<string, unknown>;

type LoggerOptions = {
    details?: LoggerDetails;
    component?: string;
    includeConsole?: boolean;
};

type ConsoleBridgeOptions = {
    enabled?: boolean;
};

type BridgeState = {
    installed: boolean;
    originalWarn?: typeof console.warn;
    originalError?: typeof console.error;
};

const bridgeState: BridgeState = {
    installed: false,
};

let inConsoleForwarding = false;

const normalizeError = (error: unknown) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    if (typeof error === 'string') {
        return {
            name: 'Error',
            message: error,
            stack: null,
        };
    }
    return null;
};

const buildContextDetails = (component?: string): LoggerDetails => {
    const activeAction = getActiveAction();
    const playback = getPlaybackTraceSnapshot();
    const lifecycleState = typeof document === 'undefined'
        ? 'unknown'
        : document.hidden
            ? 'background'
            : document.hasFocus()
                ? 'foreground'
                : 'unknown';
    return {
        correlationId: activeAction?.correlationId ?? null,
        origin: activeAction?.origin ?? null,
        actionName: activeAction?.name ?? null,
        component: component ?? activeAction?.componentName ?? null,
        lifecycleState: playback ? lifecycleState : null,
        sourceKind: playback?.sourceKind ?? null,
        localAccessMode: playback?.localAccessMode ?? null,
        trackInstanceId: playback?.trackInstanceId ?? null,
        playlistItemId: playback?.playlistItemId ?? null,
    };
};

const toLogDetails = (details: LoggerDetails = {}, component?: string) => {
    const context = buildContextDetails(component);
    const merged = {
        ...context,
        ...details,
    };

    if ('error' in merged) {
        const normalized = normalizeError(merged.error);
        merged.error = normalized ?? merged.error;
    }

    return merged;
};

const writeLog = (level: LogLevel, message: string, options: LoggerOptions = {}) => {
    const details = toLogDetails(options.details, options.component);
    addLog(level, message, details);
    if (options.includeConsole === false) return;
    if (level === 'warn') {
        console.warn(message, details);
        return;
    }
    if (level === 'error') {
        console.error(message, details);
        return;
    }
    if (level === 'info') {
        console.info(message, details);
        return;
    }
    console.debug(message, details);
};

export const logger = {
    debug: (message: string, options?: LoggerOptions) => writeLog('debug', message, options),
    info: (message: string, options?: LoggerOptions) => writeLog('info', message, options),
    warn: (message: string, options?: LoggerOptions) => writeLog('warn', message, options),
    error: (message: string, options?: LoggerOptions) => writeLog('error', message, options),
};

const normalizeConsoleMessage = (args: unknown[]) => {
    if (!args.length) return '';
    const first = args[0];
    if (typeof first === 'string') return first;
    if (first instanceof Error) return first.message;
    return String(first);
};

const normalizeConsoleDetails = (args: unknown[]) => {
    if (args.length <= 1) return {};
    const next = args.slice(1);
    const mapped = next.map((value) => {
        if (value instanceof Error) {
            return { error: normalizeError(value) };
        }
        return value;
    });
    return {
        args: mapped,
    };
};

export const installConsoleDiagnosticsBridge = (options: ConsoleBridgeOptions = {}) => {
    if (bridgeState.installed) {
        return () => {
            // no-op if already installed globally
        };
    }

    const enabled = options.enabled ?? true;
    if (!enabled) {
        return () => {
            // explicitly disabled
        };
    }

    bridgeState.installed = true;
    bridgeState.originalWarn = console.warn.bind(console);
    bridgeState.originalError = console.error.bind(console);

    console.warn = (...args: unknown[]) => {
        bridgeState.originalWarn?.(...args);
        if (inConsoleForwarding) return;
        inConsoleForwarding = true;
        try {
            logger.warn(normalizeConsoleMessage(args), {
                details: normalizeConsoleDetails(args),
                component: 'console',
                includeConsole: false,
            });
        } finally {
            inConsoleForwarding = false;
        }
    };

    console.error = (...args: unknown[]) => {
        bridgeState.originalError?.(...args);
        if (inConsoleForwarding) return;
        inConsoleForwarding = true;
        try {
            logger.error(normalizeConsoleMessage(args), {
                details: normalizeConsoleDetails(args),
                component: 'console',
                includeConsole: false,
            });
        } finally {
            inConsoleForwarding = false;
        }
    };

    return () => {
        if (!bridgeState.installed) return;
        if (bridgeState.originalWarn) {
            console.warn = bridgeState.originalWarn;
        }
        if (bridgeState.originalError) {
            console.error = bridgeState.originalError;
        }
        bridgeState.installed = false;
        bridgeState.originalWarn = undefined;
        bridgeState.originalError = undefined;
    };
};
