/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';

import { formatDiskDosStatus } from './dosStatusFormatter';

describe('formatDiskDosStatus', () => {
    it('maps DOS mismatch (73) as OK for power-up status', () => {
        const result = formatDiskDosStatus('73,U64IEC, ULTIMATE DOS V1.1,00,00');
        expect(result.message).toBe('OK');
        expect(result.severity).toBe('INFO');
        expect(result.code).toBe(73);
        expect(result.details).toContain('power-up');
    });

    it('formats parenthesized details in Camel-Case', () => {
        const result = formatDiskDosStatus('20,READ ERROR,00,00');
        expect(result.message).toBe('READ ERROR (Block Header Not Found)');
        expect(result.severity).toBe('ERROR');
        expect(result.code).toBe(20);
    });

    it('maps FILE NOT FOUND as ERROR', () => {
        const result = formatDiskDosStatus('62,FILE NOT FOUND,00,00');
        expect(result.message).toBe('FILE NOT FOUND');
        expect(result.severity).toBe('ERROR');
        expect(result.details).toContain('does not exist');
    });

    it('maps OK as INFO', () => {
        const result = formatDiskDosStatus('00,OK,00,00');
        expect(result.message).toBe('OK');
        expect(result.severity).toBe('INFO');
        expect(result.code).toBe(0);
    });

    it('keeps unknown code as raw-only', () => {
        const raw = '99,FOO,00,00';
        const result = formatDiskDosStatus(raw);
        expect(result.message).toBeNull();
        expect(result.details).toBeNull();
        expect(result.severity).toBe('ERROR');
        expect(result.code).toBe(99);
        expect(result.raw).toBe(raw);
    });

    it('ignores unused DOS codes 2-19', () => {
        const raw = '02,UNUSED,00,00';
        const result = formatDiskDosStatus(raw);
        expect(result.message).toBeNull();
        expect(result.severity).toBe('INFO');
        expect(result.code).toBe(2);
        expect(result.details).toContain('unused');
        expect(result.raw).toBe(raw);
    });

    it('keeps malformed input as raw-only', () => {
        const raw = 'MALFORMED STATUS';
        const result = formatDiskDosStatus(raw);
        expect(result.message).toBeNull();
        expect(result.details).toBeNull();
        expect(result.code).toBeNull();
        expect(result.raw).toBe(raw);
    });
});
