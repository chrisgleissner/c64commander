/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect } from 'vitest';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';

describe('normalizeConfigItem', () => {
    it('handles primitives', () => {
        expect(normalizeConfigItem('foo')).toEqual({ value: 'foo' });
        expect(normalizeConfigItem(123)).toEqual({ value: 123 });
        expect(normalizeConfigItem(null)).toEqual({ value: null });
        expect(normalizeConfigItem([])).toEqual({ value: [] });
    });

    it('extracts selected value from various aliases', () => {
        expect(normalizeConfigItem({ selected: 'a' })).toEqual({ value: 'a' });
        expect(normalizeConfigItem({ value: 'a' })).toEqual({ value: 'a' });
        expect(normalizeConfigItem({ current: 'a' })).toEqual({ value: 'a' });
        expect(normalizeConfigItem({ current_value: 'a' })).toEqual({ value: 'a' });
        expect(normalizeConfigItem({ currentValue: 'a' })).toEqual({ value: 'a' });
        expect(normalizeConfigItem({ default: 'a' })).toEqual({ value: 'a' });
        expect(normalizeConfigItem({ default_value: 'a' })).toEqual({ value: 'a' });
        expect(normalizeConfigItem({})).toEqual({ value: '' });
    });

    it('extracts options from various aliases', () => {
        expect(normalizeConfigItem({ options: ['a'] })).toMatchObject({ value: '', options: ['a'] });
        expect(normalizeConfigItem({ values: ['a'] })).toMatchObject({ value: '', options: ['a'] });
        expect(normalizeConfigItem({ choices: ['a'] })).toMatchObject({ value: '', options: ['a'] });
    });

    it('extracts presets from various aliases', () => {
        expect(normalizeConfigItem({ details: { presets: ['a'] } })).toEqual({ value: '', details: { presets: ['a'] } });
        expect(normalizeConfigItem({ presets: ['a'] })).toEqual({ value: '', details: { presets: ['a'] } });
        // values and choices are also candidates for presets if options are not found or something?
        // logic: const presetsCandidate = cfg.details?.presets ?? cfg.presets ?? cfg.values ?? cfg.choices;
        expect(normalizeConfigItem({ values: ['a', 'b'] })).toEqual({ value: '', options: ['a', 'b'], details: { presets: ['a', 'b'] } });
    });

    it('extracts range and format details', () => {
        expect(normalizeConfigItem({ details: { min: 1, max: 10, format: 'x' } })).toEqual({
            value: '',
            details: { min: 1, max: 10, format: 'x' }
        });
        expect(normalizeConfigItem({ min: 1, max: 10, format: 'x' })).toEqual({
            value: '',
            details: { min: 1, max: 10, format: 'x' }
        });
        expect(normalizeConfigItem({ minimum: 1, maximum: 10 })).toEqual({
            value: '',
            details: { min: 1, max: 10, format: undefined }
        });
    });

    it('returns undefined details if no relevant fields', () => {
        expect(normalizeConfigItem({ value: 'v' })).toEqual({ value: 'v', options: undefined, details: undefined });
    });
});
