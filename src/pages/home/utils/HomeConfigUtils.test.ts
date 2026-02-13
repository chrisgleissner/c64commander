/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
    buildConfigKey,
    formatPrinterLabel,
    formatPrinterOptionLabel,
    parseNumericValue,
    readItemDetails,
    readItemOptions,
    readItemValue,
    resolveConfigValue,
    resolveTurboControlValue,
} from './HomeConfigUtils';

describe('HomeConfigUtils', () => {
    describe('buildConfigKey', () => {
        it('builds config key from category and item name', () => {
            expect(buildConfigKey('Audio', 'Volume')).toBe('Audio::Volume');
            expect(buildConfigKey('Network', 'Hostname')).toBe('Network::Hostname');
        });
    });

    describe('readItemValue', () => {
        it('returns undefined for undefined payload', () => {
            expect(readItemValue(undefined, 'Audio', 'Volume')).toBeUndefined();
        });

        it('returns undefined for null payload', () => {
            expect(readItemValue(null, 'Audio', 'Volume')).toBeUndefined();
        });

        it('returns undefined when item not found', () => {
            const payload = { Audio: { items: {} } };
            expect(readItemValue(payload, 'Audio', 'Volume')).toBeUndefined();
        });

        it('reads value from category with items block', () => {
            const payload = {
                Audio: {
                    items: {
                        Volume: { value: '50', options: ['0', '100'] },
                    },
                },
            };
            expect(readItemValue(payload, 'Audio', 'Volume')).toBe('50');
        });

        it('reads value from category without items block', () => {
            const payload = {
                Volume: { value: '75' },
            };
            expect(readItemValue(payload, 'Audio', 'Volume')).toBe('75');
        });

        it('reads value from direct item access', () => {
            const payload = {
                Volume: { value: '100' },
            };
            expect(readItemValue(payload, 'Unknown', 'Volume')).toBe('100');
        });
    });

    describe('readItemOptions', () => {
        it('returns empty array for undefined payload', () => {
            expect(readItemOptions(undefined, 'Audio', 'Volume')).toEqual([]);
        });

        it('returns empty array when item not found', () => {
            const payload = { Audio: { items: {} } };
            expect(readItemOptions(payload, 'Audio', 'Volume')).toEqual([]);
        });

        it('reads options from item', () => {
            const payload = {
                Audio: {
                    items: {
                        Mode: { value: 'Stereo', options: ['Mono', 'Stereo', 'Surround'] },
                    },
                },
            };
            expect(readItemOptions(payload, 'Audio', 'Mode')).toEqual(['Mono', 'Stereo', 'Surround']);
        });

        it('returns empty array when options not present', () => {
            const payload = {
                Audio: {
                    items: {
                        Volume: { value: '50' },
                    },
                },
            };
            expect(readItemOptions(payload, 'Audio', 'Volume')).toEqual([]);
        });
    });

    describe('readItemDetails', () => {
        it('returns undefined for undefined payload', () => {
            expect(readItemDetails(undefined, 'Audio', 'Volume')).toBeUndefined();
        });

        it('returns undefined when item not found', () => {
            const payload = { Audio: { items: {} } };
            expect(readItemDetails(payload, 'Audio', 'Volume')).toBeUndefined();
        });

        it('reads details from item', () => {
            const payload = {
                Audio: {
                    items: {
                        Volume: { value: '50', details: { min: 0, max: 100 } },
                    },
                },
            };
            expect(readItemDetails(payload, 'Audio', 'Volume')).toEqual({ min: 0, max: 100 });
        });
    });

    describe('resolveConfigValue', () => {
        it('returns override when present', () => {
            const payload = { Audio: { items: { Volume: { value: '50' } } } };
            const overrides = { 'Audio::Volume': 75 };
            expect(resolveConfigValue(payload, 'Audio', 'Volume', 0, overrides)).toBe(75);
        });

        it('returns value from payload when no override', () => {
            const payload = { Audio: { items: { Volume: { value: '50' } } } };
            const overrides = {};
            expect(resolveConfigValue(payload, 'Audio', 'Volume', 0, overrides)).toBe('50');
        });

        it('returns fallback when value is undefined', () => {
            const payload = { Audio: { items: {} } };
            const overrides = {};
            expect(resolveConfigValue(payload, 'Audio', 'Volume', 100, overrides)).toBe(100);
        });

        it('returns numeric override', () => {
            const payload = { Audio: { items: { Volume: { value: '50' } } } };
            const overrides = { 'Audio::Volume': 100 };
            expect(resolveConfigValue(payload, 'Audio', 'Volume', 0, overrides)).toBe(100);
        });
    });

    describe('parseNumericValue', () => {
        it('parses integer value', () => {
            expect(parseNumericValue('42', 0)).toBe(42);
        });

        it('parses float value', () => {
            expect(parseNumericValue('3.14', 0)).toBeCloseTo(3.14);
        });

        it('parses value with unit suffix', () => {
            expect(parseNumericValue('8 MHz', 0)).toBe(8);
        });

        it('parses value with prefix', () => {
            expect(parseNumericValue('+5 dB', 0)).toBe(5);
            expect(parseNumericValue('-3 dB', 0)).toBe(-3);
        });

        it('returns fallback for non-numeric string', () => {
            expect(parseNumericValue('invalid', 10)).toBe(10);
        });

        it('returns fallback for empty string', () => {
            expect(parseNumericValue('', 5)).toBe(5);
        });

        it('handles numeric input directly', () => {
            expect(parseNumericValue(42, 0)).toBe(42);
        });

        it('handles whitespace', () => {
            expect(parseNumericValue('  42  ', 0)).toBe(42);
        });
    });

    describe('resolveTurboControlValue', () => {
        it('returns Off for speed <= 1', () => {
            expect(resolveTurboControlValue('1 MHz', ['Off', 'Manual'])).toBe('Off');
            expect(resolveTurboControlValue('0.5 MHz', ['Off', 'Manual'])).toBe('Off');
        });

        it('returns Manual for speed > 1', () => {
            expect(resolveTurboControlValue('2 MHz', ['Off', 'Manual'])).toBe('Manual');
            expect(resolveTurboControlValue('8 MHz', ['Off', 'Manual'])).toBe('Manual');
        });

        it('returns first option when desired not found', () => {
            expect(resolveTurboControlValue('2 MHz', ['Auto', 'Custom'])).toBe('Auto');
        });

        it('returns desired value when no options available', () => {
            expect(resolveTurboControlValue('2 MHz', [])).toBe('Manual');
        });

        it('matches case-insensitively', () => {
            expect(resolveTurboControlValue('2 MHz', ['off', 'manual'])).toBe('manual');
        });
    });

    describe('formatPrinterLabel', () => {
        it('formats Page top margin', () => {
            expect(formatPrinterLabel('Page top margin (default is 5)')).toBe('Margin');
        });

        it('formats Page height', () => {
            expect(formatPrinterLabel('Page height (default is 60)')).toBe('Height');
        });

        it('formats Output file', () => {
            expect(formatPrinterLabel('Output file')).toBe('Output');
        });

        it('formats Output type', () => {
            expect(formatPrinterLabel('Output type')).toBe('Type');
        });

        it('formats Ink density', () => {
            expect(formatPrinterLabel('Ink density')).toBe('Ink');
        });

        it('formats Commodore charset', () => {
            expect(formatPrinterLabel('Commodore charset')).toBe('CBM charset');
        });

        it('formats Epson charset', () => {
            expect(formatPrinterLabel('Epson charset')).toBe('Epson set');
        });

        it('formats IBM table 2', () => {
            expect(formatPrinterLabel('IBM table 2')).toBe('IBM set');
        });

        it('returns original name for unknown labels', () => {
            expect(formatPrinterLabel('Unknown Option')).toBe('Unknown Option');
        });
    });

    describe('formatPrinterOptionLabel', () => {
        it('formats PNG B&W', () => {
            expect(formatPrinterOptionLabel('PNG B&W')).toBe('PNG B/W');
        });

        it('formats PNG COLOR', () => {
            expect(formatPrinterOptionLabel('PNG COLOR')).toBe('PNG Color');
        });

        it('formats IBM Graphics Printer', () => {
            expect(formatPrinterOptionLabel('IBM Graphics Printer')).toBe('IBM Graphics');
        });

        it('formats Commodore MPS', () => {
            expect(formatPrinterOptionLabel('Commodore MPS')).toBe('MPS');
        });

        it('formats Epson FX-80/JX-80', () => {
            expect(formatPrinterOptionLabel('Epson FX-80/JX-80')).toBe('Epson FX');
        });

        it('formats IBM Proprinter', () => {
            expect(formatPrinterOptionLabel('IBM Proprinter')).toBe('IBM Pro');
        });

        it('formats USA/UK', () => {
            expect(formatPrinterOptionLabel('USA/UK')).toBe('US/UK');
        });

        it('formats France/Italy', () => {
            expect(formatPrinterOptionLabel('France/Italy')).toBe('FR/IT');
        });

        it('formats Germany', () => {
            expect(formatPrinterOptionLabel('Germany')).toBe('DE');
        });

        it('formats Denmark', () => {
            expect(formatPrinterOptionLabel('Denmark')).toBe('DK');
        });

        it('formats Denmark I', () => {
            expect(formatPrinterOptionLabel('Denmark I')).toBe('DK I');
        });

        it('formats Denmark II', () => {
            expect(formatPrinterOptionLabel('Denmark II')).toBe('DK II');
        });

        it('formats Spain', () => {
            expect(formatPrinterOptionLabel('Spain')).toBe('ES');
        });

        it('formats Sweden', () => {
            expect(formatPrinterOptionLabel('Sweden')).toBe('SE');
        });

        it('formats Switzerland', () => {
            expect(formatPrinterOptionLabel('Switzerland')).toBe('CH');
        });

        it('formats France', () => {
            expect(formatPrinterOptionLabel('France')).toBe('FR');
        });

        it('formats Italy', () => {
            expect(formatPrinterOptionLabel('Italy')).toBe('IT');
        });

        it('formats Norway', () => {
            expect(formatPrinterOptionLabel('Norway')).toBe('NO');
        });

        it('formats Portugal', () => {
            expect(formatPrinterOptionLabel('Portugal')).toBe('PT');
        });

        it('formats Greece', () => {
            expect(formatPrinterOptionLabel('Greece')).toBe('GR');
        });

        it('formats Israel', () => {
            expect(formatPrinterOptionLabel('Israel')).toBe('IL');
        });

        it('formats Japan', () => {
            expect(formatPrinterOptionLabel('Japan')).toBe('JP');
        });

        it('formats International 1', () => {
            expect(formatPrinterOptionLabel('International 1')).toBe('Intl 1');
        });

        it('formats International 2', () => {
            expect(formatPrinterOptionLabel('International 2')).toBe('Intl 2');
        });

        it('returns trimmed original for unknown values', () => {
            expect(formatPrinterOptionLabel('  Unknown Value  ')).toBe('Unknown Value');
        });
    });
});
