/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { isSonglengthsFileName } from '@/lib/sid/songlengthsDiscovery';

describe('songlengths discovery helpers', () => {
  it('accepts .txt and .md5 case-insensitively', () => {
    expect(isSonglengthsFileName('songlengths.txt')).toBe(true);
    expect(isSonglengthsFileName('SONGLENGTHS.TXT')).toBe(true);
    expect(isSonglengthsFileName('songlengths.md5')).toBe(true);
    expect(isSonglengthsFileName('Songlengths.MD5')).toBe(true);
  });

  it('rejects unsupported extensions', () => {
    expect(isSonglengthsFileName('songlengths.sid')).toBe(false);
    expect(isSonglengthsFileName('notes.md')).toBe(false);
  });
});
