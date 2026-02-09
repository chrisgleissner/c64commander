/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { getTraceTitle } from '@/lib/tracing/traceFormatter';
import type { TraceEvent } from '@/lib/tracing/types';

describe('traceFormatter', () => {
    it('formats action-start', () => {
        const event = { type: 'action-start', data: { name: 'MyAction' }, origin: 'user' } as unknown as TraceEvent;
        expect(getTraceTitle(event)).toBe('Action: MyAction');
    });
    
    it('formats rest-request', () => {
        const event = { type: 'rest-request', data: { method: 'GET', url: '/api' }, origin: 'user' } as unknown as TraceEvent;
        expect(getTraceTitle(event)).toBe('REST GET /api');
    });
    
    it('formats rest-response', () => {
        const event = { type: 'rest-response', data: { status: 200, durationMs: 15 }, origin: 'user' } as unknown as TraceEvent;
        expect(getTraceTitle(event)).toBe('Response 200 (15ms)');
    });
    
    it('formats default', () => {
        const event = { type: 'unknown', data: {}, origin: 'user' } as unknown as TraceEvent;
        expect(getTraceTitle(event)).toBe('unknown · user');
    });
});
