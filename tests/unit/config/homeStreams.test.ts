import { describe, expect, it } from 'vitest';
import {
  buildStreamConfigValue,
  buildStreamControlEntries,
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
    expect(validateStreamHost('c64u.local')).toBeNull();
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
});

