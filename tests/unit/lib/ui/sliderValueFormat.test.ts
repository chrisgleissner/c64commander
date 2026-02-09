/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect } from 'vitest';
import { formatDbValue, formatPanValue } from '@/lib/ui/sliderValueFormat';

describe('sliderValueFormat', () => {
    describe('formatDbValue', () => {
        it('formats numeric dB values', () => {
            expect(formatDbValue('0')).toBe('0 dB');
            expect(formatDbValue('10')).toBe('+10 dB');
            expect(formatDbValue('-10')).toBe('-10 dB');
            expect(formatDbValue('3.5')).toBe('+3.5 dB');
        });

        it('returns original string if not numeric', () => {
            expect(formatDbValue('Mute')).toBe('Mute');
            expect(formatDbValue('')).toBe('');
        });
        
        it('handles surrounding whitespace', () => {
             expect(formatDbValue('  5  ')).toBe('+5 dB');
        });
    });

    describe('formatPanValue', () => {
        it('formats center', () => {
            expect(formatPanValue('Center')).toBe('C');
            expect(formatPanValue('centre')).toBe('C');
            expect(formatPanValue('0')).toBe('C');
        });

        it('formats left', () => {
            expect(formatPanValue('Left')).toBe('L');
            expect(formatPanValue('left 50')).toBe('L 50');
            expect(formatPanValue('-50')).toBe('L 50');
            expect(formatPanValue('-50.5')).toBe('L 50.5');
        });

        it('formats right', () => {
            expect(formatPanValue('Right')).toBe('R');
            expect(formatPanValue('right 50')).toBe('R 50');
            expect(formatPanValue('50')).toBe('R 50');
        });
        
        it('handles odd inputs', () => {
            // normalized.startsWith('left') -> check numeric
             expect(formatPanValue('Leftish')).toBe('L');
        });
    });
});
