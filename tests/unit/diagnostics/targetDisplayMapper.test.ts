/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { mapTargetDisplayLabel } from '@/lib/diagnostics/targetDisplayMapper';

describe('mapTargetDisplayLabel', () => {
    it('maps internal mock target to demo', () => {
        expect(mapTargetDisplayLabel('internal-mock')).toBe('demo');
    });

    it('maps external mock target to sandbox', () => {
        expect(mapTargetDisplayLabel('external-mock')).toBe('sandbox');
    });

    it('maps mock target aliases to demo/sandbox', () => {
        expect(mapTargetDisplayLabel('internal_mock')).toBe('demo');
        expect(mapTargetDisplayLabel('Internal Mock')).toBe('demo');
        expect(mapTargetDisplayLabel('external_mock')).toBe('sandbox');
        expect(mapTargetDisplayLabel('External Mock')).toBe('sandbox');
    });

    it('maps real-device to known products', () => {
        expect(mapTargetDisplayLabel('real-device', 'c64u')).toBe('c64u');
        expect(mapTargetDisplayLabel('real-device', 'u64')).toBe('u64');
        expect(mapTargetDisplayLabel('real-device', 'u64e')).toBe('u64e');
        expect(mapTargetDisplayLabel('real-device', 'u64e2')).toBe('u64e2');
    });

    it('maps real-device unknown or missing product to device', () => {
        expect(mapTargetDisplayLabel('real-device')).toBe('device');
        expect(mapTargetDisplayLabel('real-device', null)).toBe('device');
        expect(mapTargetDisplayLabel('real-device', 'unknown-model')).toBe('device');
    });

    it('keeps mock mapping even when product leaks mock labels under real-device', () => {
        expect(mapTargetDisplayLabel('real-device', 'internal-mock')).toBe('demo');
        expect(mapTargetDisplayLabel('real-device', 'external-mock')).toBe('sandbox');
        expect(mapTargetDisplayLabel('real-device', 'sandbox')).toBe('sandbox');
        expect(mapTargetDisplayLabel('real-device', 'demo')).toBe('demo');
    });

    it('normalizes known aliases for products', () => {
        expect(mapTargetDisplayLabel('real-device', 'C64 Ultimate')).toBe('c64u');
        expect(mapTargetDisplayLabel('real-device', 'Ultimate64')).toBe('u64');
        expect(mapTargetDisplayLabel('real-device', 'Ultimate 64')).toBe('u64');
        expect(mapTargetDisplayLabel('real-device', 'Ultimate 64 Elite')).toBe('u64e');
        expect(mapTargetDisplayLabel('real-device', 'Ultimate 64-II')).toBe('u64e2');
        expect(mapTargetDisplayLabel('real-device', 'U64E MK2')).toBe('u64e2');
    });

    it('never renders mock for legacy mock input', () => {
        expect(mapTargetDisplayLabel('mock')).toBe('demo');
        expect(mapTargetDisplayLabel('mock')).not.toContain('mock');
    });

    it('never renders c64 fallback', () => {
        expect(mapTargetDisplayLabel('real-device', 'c64')).toBe('device');
        expect(mapTargetDisplayLabel('c64')).toBe('device');
    });

    it('passes known product tokens as-is when used as targetType directly (BRDA:52)', () => {
        // KNOWN_PRODUCT_TOKENS contains 'c64u', 'u64', 'u64e', 'u64e2'
        // When these are passed as targetType (not 'real-device'), they return themselves
        expect(mapTargetDisplayLabel('c64u')).toBe('c64u');
        expect(mapTargetDisplayLabel('u64')).toBe('u64');
        expect(mapTargetDisplayLabel('u64e')).toBe('u64e');
        expect(mapTargetDisplayLabel('u64e2')).toBe('u64e2');
    });
});
