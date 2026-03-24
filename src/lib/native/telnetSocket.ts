/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';
import type { NativeTraceContext } from '@/lib/native/nativeTraceContext';

export type TelnetSocketConnectOptions = {
    host: string;
    port: number;
    timeoutMs?: number;
    traceContext?: NativeTraceContext;
};

export type TelnetSocketSendOptions = {
    data: string; // Base64-encoded bytes
};

export type TelnetSocketReadOptions = {
    timeoutMs: number;
};

export type TelnetSocketReadResult = {
    data: string; // Base64-encoded bytes
};

export type TelnetSocketPlugin = {
    connect(options: TelnetSocketConnectOptions): Promise<void>;
    disconnect(): Promise<void>;
    send(options: TelnetSocketSendOptions): Promise<void>;
    read(options: TelnetSocketReadOptions): Promise<TelnetSocketReadResult>;
    isConnected(): Promise<{ connected: boolean }>;
};

export const TelnetSocket = registerPlugin<TelnetSocketPlugin>(
    'TelnetSocket',
    {
        web: () =>
            import('./telnetSocket.web').then(
                (module) => new module.TelnetSocketWeb(),
            ),
    },
);
