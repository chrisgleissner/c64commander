/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';
import { getActiveAction } from '@/lib/tracing/actionTrace';
import { resolveNativeTraceContext, type NativeTraceContext } from '@/lib/native/nativeTraceContext';

export type BackgroundExecutionPlugin = {
    start: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
    stop: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
};

const plugin = registerPlugin<BackgroundExecutionPlugin>('BackgroundExecution', {
    web: () => import('./backgroundExecution.web').then((m) => new m.BackgroundExecutionWeb()),
});

export const BackgroundExecution: BackgroundExecutionPlugin = {
    start: (options) => plugin.start({
        ...options,
        traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
    stop: (options) => plugin.stop({
        ...options,
        traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
};
