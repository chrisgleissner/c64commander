/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { BackgroundExecutionPlugin } from './backgroundExecution';
import { addLog } from '@/lib/logging';

/**
 * Web fallback with best-effort parity:
 * - acquires screen wake lock where supported,
 * - emits `backgroundAutoSkipDue` when due timer elapses.
 */
export class BackgroundExecutionWeb implements BackgroundExecutionPlugin {
    private wakeLock: { release?: () => Promise<void> } | null = null;

    private dueTimer: number | null = null;

    private listeners = new Set<(event: { dueAtMs: number; firedAtMs: number }) => void>();

    async start(): Promise<void> {
        if (this.wakeLock) return;
        const wakeLockApi = (navigator as Navigator & {
            wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        }).wakeLock;
        if (!wakeLockApi) {
            addLog('info', 'Background execution wake lock unavailable on web', {
                source: 'background-execution-web',
            });
            return;
        }
        try {
            this.wakeLock = await wakeLockApi.request('screen');
        } catch (error) {
            addLog('warn', 'Web wake lock request failed', {
                source: 'background-execution-web',
                error: (error as Error).message,
            });
        }
    }

    async stop(): Promise<void> {
        if (this.dueTimer !== null) {
            window.clearTimeout(this.dueTimer);
            this.dueTimer = null;
        }
        if (!this.wakeLock?.release) {
            this.wakeLock = null;
            return;
        }
        try {
            await this.wakeLock.release();
        } catch (error) {
            addLog('warn', 'Web wake lock release failed', {
                source: 'background-execution-web',
                error: (error as Error).message,
            });
        } finally {
            this.wakeLock = null;
        }
    }

    async setDueAtMs(options: { dueAtMs: number | null }): Promise<void> {
        if (this.dueTimer !== null) {
            window.clearTimeout(this.dueTimer);
            this.dueTimer = null;
        }

        if (options.dueAtMs === null) {
            return;
        }

        const nowMs = Date.now();
        const delayMs = Math.max(0, options.dueAtMs - nowMs);
        this.dueTimer = window.setTimeout(() => {
            const event = {
                dueAtMs: options.dueAtMs as number,
                firedAtMs: Date.now(),
            };
            this.listeners.forEach((listener) => {
                try {
                    listener(event);
                } catch (error) {
                    addLog('warn', 'Web background due listener failed', {
                        source: 'background-execution-web',
                        error: (error as Error).message,
                    });
                }
            });
        }, delayMs);
    }

    async addListener(
        eventName: 'backgroundAutoSkipDue',
        listenerFunc: (event: { dueAtMs: number; firedAtMs: number }) => void,
    ): Promise<{ remove: () => Promise<void> }> {
        if (eventName !== 'backgroundAutoSkipDue') {
            addLog('warn', 'Unsupported web background execution listener event', {
                source: 'background-execution-web',
                eventName,
            });
        }
        this.listeners.add(listenerFunc);
        return {
            remove: async () => {
                this.listeners.delete(listenerFunc);
            },
        };
    }
}
