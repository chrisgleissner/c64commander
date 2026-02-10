/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  buildStreamConfigValue,
  buildStreamControlEntries,
  buildStreamEndpointLabel,
  parseStreamEndpoint,
  validateStreamHost,
  validateStreamPort,
} from '@/lib/config/homeStreams';

describe('homeStreams', () => {
  it('maps stream config values into editable stream entries', () => {
    const entries = buildStreamControlEntries({
      'Data Streams': {
        items: {
          'Stream VIC to': { selected: '239.0.1.64:11000' },
          'Stream Audio to': { selected: 'off' },
          'Stream Debug to': { selected: '239.0.1.66' },
        },
      },
    });

    expect(entries.map((entry) => entry.label)).toEqual(['VIC', 'Audio', 'Debug']);
    expect(entries[0]).toMatchObject({ enabled: true, ip: '239.0.1.64', port: '11000' });
    expect(entries[1]).toMatchObject({ enabled: false, ip: '', port: '11001' });
    expect(entries[2]).toMatchObject({ enabled: true, ip: '239.0.1.66', port: '11002' });
  });

  it('validates stream hosts and ports', () => {
    expect(validateStreamHost('239.0.1.64')).toBeNull();
    expect(validateStreamHost('c64u.local')).toContain('valid IPv4');
    expect(validateStreamHost('bad host!')).toContain('valid IPv4');

    expect(validateStreamPort('11000')).toBeNull();
    expect(validateStreamPort('')).toContain('required');
    expect(validateStreamPort('abc')).toContain('numeric');
    expect(validateStreamPort('70000')).toContain('between 1 and 65535');
  });

  it('builds stream config values', () => {
    expect(buildStreamConfigValue(false, '239.0.1.64', '11000')).toBe('off');
    expect(buildStreamConfigValue(true, '239.0.1.64', '11000')).toBe('239.0.1.64:11000');
  });

  it('formats and parses stream endpoint labels', () => {
    expect(buildStreamEndpointLabel('239.0.1.64', '11000')).toBe('239.0.1.64:11000');
    expect(parseStreamEndpoint('239.0.1.64:11000')).toEqual({ ip: '239.0.1.64', port: '11000', error: null });
    expect(parseStreamEndpoint('239.0.1.64')).toMatchObject({ error: 'Enter endpoint as IPv4:port.' });
  });
});
