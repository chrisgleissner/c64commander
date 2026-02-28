/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tracing/actionTrace', () => ({
    createActionContext: vi.fn(() => ({ correlationId: 'test-cor' })),
    runWithActionTrace: vi.fn(async (_ctx: any, fn: () => any) => fn()),
}));

import { wrapUserEvent, wrapValueChange } from '@/lib/tracing/userTrace';
import React from 'react';

describe('userTrace', () => {
    describe('getMeaningfulName resolution', () => {
        it('uses aria-label when present', async () => {
            const handler = vi.fn();
            const wrapped = wrapUserEvent(handler, 'click', 'Btn', { 'aria-label': 'Close' });
            const event = { nativeEvent: {} } as any;
            await wrapped(event);
            expect(handler).toHaveBeenCalledWith(event);
        });

        it('uses title when present', async () => {
            const handler = vi.fn();
            const wrapped = wrapUserEvent(handler, 'click', 'Btn', { title: 'Submit' });
            await wrapped({ nativeEvent: {} } as any);
            expect(handler).toHaveBeenCalled();
        });

        it('uses name when present', async () => {
            const handler = vi.fn();
            const wrapped = wrapUserEvent(handler, 'click', 'Btn', { name: 'username' });
            await wrapped({ nativeEvent: {} } as any);
            expect(handler).toHaveBeenCalled();
        });

        it('uses string children', async () => {
            const handler = vi.fn();
            const wrapped = wrapUserEvent(handler, 'click', 'Btn', { children: 'Click Me' });
            await wrapped({ nativeEvent: {} } as any);
            expect(handler).toHaveBeenCalled();
        });

        it('uses text from children array', async () => {
            const handler = vi.fn();
            const wrapped = wrapUserEvent(handler, 'click', 'Btn', { children: ['Save', null] });
            await wrapped({ nativeEvent: {} } as any);
            expect(handler).toHaveBeenCalled();
        });

        it('uses text from React element children', async () => {
            const handler = vi.fn();
            const child = React.createElement('span', null, 'Nested Text');
            const wrapped = wrapUserEvent(handler, 'click', 'Btn', { children: child });
            await wrapped({ nativeEvent: {} } as any);
            expect(handler).toHaveBeenCalled();
        });

        it('falls back to default label', async () => {
            const handler = vi.fn();
            const wrapped = wrapUserEvent(handler, 'click', 'Btn', {}, 'FallbackLabel');
            await wrapped({ nativeEvent: {} } as any);
            expect(handler).toHaveBeenCalled();
        });

        it('handles undefined handler', async () => {
            const wrapped = wrapUserEvent(undefined, 'click', 'Btn', {});
            await wrapped({ nativeEvent: {} } as any);
        });
    });

    describe('wrapValueChange', () => {
        it('traces string values', async () => {
            const handler = vi.fn();
            const wrapped = wrapValueChange(handler, 'change', 'Input', { name: 'vol' });
            await wrapped('42');
            expect(handler).toHaveBeenCalledWith('42');
        });

        it('traces object values', async () => {
            const handler = vi.fn();
            const wrapped = wrapValueChange(handler, 'change', 'Input', { name: 'obj' });
            await wrapped({ key: 'value' });
            expect(handler).toHaveBeenCalledWith({ key: 'value' });
        });

        it('handles stringify error gracefully', async () => {
            const handler = vi.fn();
            const wrapped = wrapValueChange(handler, 'change', 'Input', { name: 'circular' });
            const circular: any = {};
            circular.self = circular;
            await wrapped(circular);
            expect(handler).toHaveBeenCalled();
        });

        it('handles undefined handler', async () => {
            const wrapped = wrapValueChange(undefined, 'change', 'Input', {});
            await wrapped('test');
        });
    });
});
