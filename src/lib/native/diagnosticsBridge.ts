import { registerPlugin } from '@capacitor/core';
import { logger } from '@/lib/diagnostics/logger';

type NativeDiagnosticsLogEvent = {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    details?: Record<string, unknown>;
};

type DiagnosticsBridgePlugin = {
    addListener: (
        eventName: 'diagnosticsLog',
        listenerFunc: (event: NativeDiagnosticsLogEvent) => void,
    ) => Promise<{ remove: () => Promise<void> }>;
    updateDebugSnapshots: (payload: {
        trace: string;
        actions: string;
        log: string;
        errorLog: string;
    }) => Promise<void>;
};

const DiagnosticsBridge = registerPlugin<DiagnosticsBridgePlugin>('DiagnosticsBridge');

let subscription: { remove: () => Promise<void> } | null = null;

export const startNativeDiagnosticsBridge = async () => {
    if (subscription) return;
    try {
        subscription = await DiagnosticsBridge.addListener('diagnosticsLog', (event) => {
            const level = event.level ?? 'info';
            if (level === 'warn') {
                logger.warn(event.message, {
                    details: {
                        ...event.details,
                        origin: event.details?.origin ?? 'native',
                    },
                    component: 'native',
                    includeConsole: false,
                });
                return;
            }
            if (level === 'error') {
                logger.error(event.message, {
                    details: {
                        ...event.details,
                        origin: event.details?.origin ?? 'native',
                    },
                    component: 'native',
                    includeConsole: false,
                });
                return;
            }
            if (level === 'debug') {
                logger.debug(event.message, {
                    details: {
                        ...event.details,
                        origin: event.details?.origin ?? 'native',
                    },
                    component: 'native',
                    includeConsole: false,
                });
                return;
            }
            logger.info(event.message, {
                details: {
                    ...event.details,
                    origin: event.details?.origin ?? 'native',
                },
                component: 'native',
                includeConsole: false,
            });
        });
    } catch (error) {
        logger.warn('DiagnosticsBridge unavailable; native diagnostics mirroring disabled', {
            details: {
                origin: 'native',
                error,
            },
            component: 'native',
            includeConsole: false,
        });
    }
};

export const stopNativeDiagnosticsBridge = async () => {
    if (!subscription) return;
    try {
        await subscription.remove();
    } finally {
        subscription = null;
    }
};

export const pushNativeDebugSnapshots = async (payload: {
    trace: string;
    actions: string;
    log: string;
    errorLog: string;
}) => {
    await DiagnosticsBridge.updateDebugSnapshots(payload);
};
