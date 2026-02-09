/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect } from 'vitest';
import { redactTreeUri } from '@/lib/native/safUtils';

describe('safUtils', () => {
    describe('redactTreeUri', () => {
        it('returns null for empty values', () => {
            expect(redactTreeUri(null)).toBeNull();
            expect(redactTreeUri(undefined)).toBeNull();
            expect(redactTreeUri('')).toBeNull();
            expect(redactTreeUri('   ')).toBeNull();
        });

        it('redacts short paths (<= 2 parts)', () => {
             // parts <= 2
             // "foo" -> parts ["foo"] (len 1)
             // "foo/bar" -> parts ["foo", "bar"] (len 2)
             
             expect(redactTreeUri('short')).toBe('short');
             expect(redactTreeUri('toolongfilename')).toBe('toolongfilen...'); // > 12 chars
             
             // How split works: 'a/b'.split('/') -> ['a', 'b']
        });

        it('redacts long filenames in structure', () => {
            // 'a/b/c' -> parts ['a', 'b', 'c'] (len 3)
            // last = 'c'
            
            expect(redactTreeUri('path/to/file.txt')).toBe('path/to/file.txt');
            
            const longName = 'verylongfilename.txt';
            // last.length > 8 -> very...txt
            expect(redactTreeUri(`path/to/${longName}`)).toBe('path/to/very...txt');
        });
        
        it('handles boundary conditions', () => {
            // "short" -> len 5 <= 12 -> "short"
            // "123456789012" -> len 12 -> "123456789012"
            // "1234567890123" -> len 13 -> "123456789012..."
             expect(redactTreeUri('123456789012')).toBe('123456789012');
             expect(redactTreeUri('1234567890123')).toBe('123456789012...');
             
             // For structured path:
             // last part > 8 chars gets abbreviated
             // "a/b/12345678" -> "a/b/12345678"
             // "a/b/123456789" -> "a/b/1234...789"
              expect(redactTreeUri('a/b/12345678')).toBe('a/b/12345678');
              expect(redactTreeUri('a/b/123456789')).toBe('a/b/1234...789');
        });
        
        it('handles intermediate empty parts', () => {
            expect(redactTreeUri('a//b/c')).toBe('a//b/c');
            expect(redactTreeUri('a//b/looooooongfilename')).toBe('a//b/looo...ame');
        });
    });
});
