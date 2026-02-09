/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionContext, runWithActionTrace } from '@/lib/tracing/actionTrace';
import { clearTraceEvents, getTraceEvents, resetTraceSession } from '@/lib/tracing/traceSession';
import {
    resetDiagnosticsOverlayState,
    setDiagnosticsOverlayActive,
    withDiagnosticsTraceOverride,
} from '@/lib/diagnostics/diagnosticsOverlayState';

describe('diagnostics overlay suppression', () => {
    beforeEach(() => {
        resetDiagnosticsOverlayState();
        resetTraceSession(0, 0);
        clearTraceEvents();
        vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout, CustomEvent: class { } });
    });

    it('suppresses action traces while overlay is active', async () => {
        setDiagnosticsOverlayActive(true);
        const context = createActionContext('Diagnostics.tabSwitch', 'user', 'SettingsPage');

        await runWithActionTrace(context, async () => undefined);

        expect(getTraceEvents()).toHaveLength(0);
    });

    it('allows traces during diagnostics share override', async () => {
        setDiagnosticsOverlayActive(true);
        const context = createActionContext('Diagnostics.share', 'user', 'SettingsPage');

        await withDiagnosticsTraceOverride(() => runWithActionTrace(context, async () => undefined));

        const events = getTraceEvents();
        expect(events.some((event) => event.type === 'action-start')).toBe(true);
        expect(events.some((event) => event.type === 'action-end')).toBe(true);
    });

    it('records actions and errors when suppressed action throws', async () => {
        setDiagnosticsOverlayActive(true);
        const context = createActionContext('Diagnostics.fail', 'user', 'SettingsPage');

        await expect(
            runWithActionTrace(context, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        const events = getTraceEvents();
        expect(events.some((event) => event.type === 'action-start')).toBe(true);
        expect(events.some((event) => event.type === 'action-end')).toBe(true);
        expect(events.some((event) => event.type === 'error')).toBe(true);
    });
});
