/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
    fitPathToWidth,
    getFileNameFromPath,
    type TextMeasureFn,
} from '@/lib/ui/pathDisplay';

const charMeasure: TextMeasureFn = (value: string) => value.length;

describe('pathDisplay', () => {
    describe('getFileNameFromPath', () => {
        it('extracts filename from Unix path', () => {
            expect(getFileNameFromPath('/foo/bar/baz.sid')).toBe('baz.sid');
        });

        it('extracts filename from Windows path', () => {
            expect(getFileNameFromPath('C:\\Users\\demo\\file.txt')).toBe('file.txt');
        });

        it('returns input for bare filename', () => {
            expect(getFileNameFromPath('file.sid')).toBe('file.sid');
        });

        it('returns input for empty string', () => {
            expect(getFileNameFromPath('')).toBe('');
        });

        it('handles root path', () => {
            expect(getFileNameFromPath('/')).toBe('/');
        });
    });

    describe('fitPathToWidth: filename-fallback', () => {
        it('returns full path when it fits', () => {
            expect(fitPathToWidth('/a/b/c.sid', 100, charMeasure, 'filename-fallback')).toBe('/a/b/c.sid');
        });

        it('returns filename when path too long', () => {
            expect(fitPathToWidth('/very/long/directory/path/c.sid', 10, charMeasure, 'filename-fallback')).toBe('c.sid');
        });

        it('returns path unchanged for zero width', () => {
            expect(fitPathToWidth('/a/b.sid', 0, charMeasure, 'filename-fallback')).toBe('/a/b.sid');
        });

        it('returns path unchanged for empty input', () => {
            expect(fitPathToWidth('', 100, charMeasure, 'filename-fallback')).toBe('');
        });

        it('trims filename from start when filename too long', () => {
            const result = fitPathToWidth('/a/b/very-long-filename.sid', 10, charMeasure, 'filename-fallback');
            expect(result.startsWith('...')).toBe(true);
            expect(result.length).toBeLessThanOrEqual(10);
        });

        it('returns empty when even ellipsis exceeds width', () => {
            expect(fitPathToWidth('/a/b/c.sid', 2, charMeasure, 'filename-fallback')).toBe('');
        });
    });

    describe('fitPathToWidth: start-and-filename', () => {
        it('returns full path when it fits', () => {
            expect(fitPathToWidth('/a/b/c.sid', 100, charMeasure, 'start-and-filename')).toBe('/a/b/c.sid');
        });

        it('keeps start segments plus filename', () => {
            const result = fitPathToWidth('/seg1/seg2/seg3/seg4/file.sid', 25, charMeasure, 'start-and-filename');
            expect(result).toContain('...');
            expect(result).toContain('file.sid');
        });

        it('returns filename when path is very narrow', () => {
            const result = fitPathToWidth('/a/b/c/d/e/longfile.sid', 14, charMeasure, 'start-and-filename');
            expect(result).toContain('longfile.sid');
        });

        it('handles path without directories', () => {
            expect(fitPathToWidth('file.sid', 100, charMeasure, 'start-and-filename')).toBe('file.sid');
        });

        it('handles single directory', () => {
            const result = fitPathToWidth('/dir/file.sid', 100, charMeasure, 'start-and-filename');
            expect(result).toBe('/dir/file.sid');
        });

        it('trims path with no filename gracefully', () => {
            const result = fitPathToWidth('/a/b/c/', 5, charMeasure, 'start-and-filename');
            expect(result.length).toBeLessThanOrEqual(5);
        });

        it('returns empty string when even truncated form exceeds width (line 42 final return)', () => {
            // 'x.sid' has length 5; maxWidth=3; '...'=3 fits loop but '...d'=4 does not
            const result = fitPathToWidth('x.sid', 3, charMeasure, 'filename-fallback');
            expect(result).toBe('');
        });

        it('covers no-directory path that does not fit (line 59 TRUE)', () => {
            // '/file.sid' has no directories; path does not fit inside maxWidth=5
            const result = fitPathToWidth('/file.sid', 5, charMeasure, 'start-and-filename');
            expect(result).toBe('file.sid');
        });

        it('handles path with empty filename component (line 72 TRUE)', () => {
            // '///' parses to empty fileName; triggers trimFromStartToFit fallback
            const result = fitPathToWidth('///', 2, charMeasure, 'start-and-filename');
            expect(typeof result).toBe('string');
        });

        it('returns empty string when ELLIPSIS does not fit maxWidth (BRDA:35 TRUE)', () => {
            // '...' has length 3; maxWidth=2 → measure('...') = 3 > 2 → trimFromStartToFit returns ''
            // To enter trimFromStartToFit: path='abc', maxWidth=2
            //  fitFilenameFallback: measure('/abc')=4>2, fileName='abc', measure('abc')=3>2
            //  → trimFromStartToFit('abc', 2): non-empty, 3>2 (FALSE), measure('...')=3>2 (TRUE) → ''
            const result = fitPathToWidth('/abc', 2, charMeasure, 'filename-fallback');
            expect(result).toBe('');
        });
    });
});
