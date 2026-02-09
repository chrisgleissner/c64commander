/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { LED_FIXED_COLORS, getLedColorRgb, rgbToCss } from '@/lib/config/ledColors';

describe('ledColors', () => {
    describe('LED_FIXED_COLORS', () => {
        it('contains all expected color definitions', () => {
            const expectedColors = [
                'Red',
                'Scarlet',
                'Orange',
                'Amber',
                'Yellow',
                'Lemon-Lime',
                'Chartreuse',
                'Lime',
                'Green',
                'Jade',
                'Spring Green',
                'Aquamarine',
                'Cyan',
                'Deep Sky Blue',
                'Azure',
                'Royal Blue',
                'Blue',
                'Indigo',
                'Violet',
                'Purple',
                'Magenta',
                'Fuchsia',
                'Rose',
                'Cerise',
                'White',
            ];

            const actualColors = LED_FIXED_COLORS.map((c) => c.name);
            expect(actualColors).toEqual(expectedColors);
        });

        it('each color has valid RGB values', () => {
            LED_FIXED_COLORS.forEach((color) => {
                expect(color.rgb.r).toBeGreaterThanOrEqual(0);
                expect(color.rgb.r).toBeLessThanOrEqual(255);
                expect(color.rgb.g).toBeGreaterThanOrEqual(0);
                expect(color.rgb.g).toBeLessThanOrEqual(255);
                expect(color.rgb.b).toBeGreaterThanOrEqual(0);
                expect(color.rgb.b).toBeLessThanOrEqual(255);
            });
        });

        it('contains Royal Blue with correct RGB values', () => {
            const royalBlue = LED_FIXED_COLORS.find((c) => c.name === 'Royal Blue');
            expect(royalBlue).toBeDefined();
            expect(royalBlue?.rgb).toEqual({ r: 0, g: 63, b: 255 });
        });

        it('contains White with correct RGB values', () => {
            const white = LED_FIXED_COLORS.find((c) => c.name === 'White');
            expect(white).toBeDefined();
            expect(white?.rgb).toEqual({ r: 255, g: 255, b: 255 });
        });

        it('contains Red with correct RGB values', () => {
            const red = LED_FIXED_COLORS.find((c) => c.name === 'Red');
            expect(red).toBeDefined();
            expect(red?.rgb).toEqual({ r: 255, g: 0, b: 0 });
        });
    });

    describe('rgbToCss', () => {
        it('converts RGB values to CSS rgb() string', () => {
            expect(rgbToCss({ r: 255, g: 0, b: 0 })).toBe('rgb(255, 0, 0)');
            expect(rgbToCss({ r: 0, g: 63, b: 255 })).toBe('rgb(0, 63, 255)');
            expect(rgbToCss({ r: 255, g: 255, b: 255 })).toBe('rgb(255, 255, 255)');
            expect(rgbToCss({ r: 128, g: 128, b: 128 })).toBe('rgb(128, 128, 128)');
        });

        it('handles zero values correctly', () => {
            expect(rgbToCss({ r: 0, g: 0, b: 0 })).toBe('rgb(0, 0, 0)');
        });
    });

    describe('getLedColorRgb', () => {
        it('returns RGB values for valid color names (case insensitive)', () => {
            expect(getLedColorRgb('Royal Blue')).toEqual({ r: 0, g: 63, b: 255 });
            expect(getLedColorRgb('royal blue')).toEqual({ r: 0, g: 63, b: 255 });
            expect(getLedColorRgb('ROYAL BLUE')).toEqual({ r: 0, g: 63, b: 255 });
            expect(getLedColorRgb('Red')).toEqual({ r: 255, g: 0, b: 0 });
            expect(getLedColorRgb('red')).toEqual({ r: 255, g: 0, b: 0 });
        });

        it('returns null for invalid color names', () => {
            expect(getLedColorRgb('Invalid Color')).toBeNull();
            expect(getLedColorRgb('')).toBeNull();
            expect(getLedColorRgb('Unknown')).toBeNull();
        });

        it('returns null for empty string', () => {
            expect(getLedColorRgb('')).toBeNull();
        });

        it('handles colors with special characters in names', () => {
            expect(getLedColorRgb('Lemon-Lime')).toEqual({ r: 191, g: 255, b: 0 });
            expect(getLedColorRgb('lemon-lime')).toEqual({ r: 191, g: 255, b: 0 });
        });

        it('handles colors with spaces in names', () => {
            expect(getLedColorRgb('Spring Green')).toEqual({ r: 0, g: 255, b: 128 });
            expect(getLedColorRgb('Deep Sky Blue')).toEqual({ r: 0, g: 191, b: 255 });
        });
    });
});
