import { describe, expect, it } from 'vitest';
import { buildStreamStatusEntries } from '@/lib/config/streamStatus';

describe('streamStatus', () => {
  it('parses ON states with explicit targets', () => {
    const result = buildStreamStatusEntries({
      'Data Streams': {
        items: {
          'Stream VIC to': { selected: '192.168.1.20:11000' },
          'Stream Audio to': { selected: '192.168.1.21:11001' },
          'Stream Debug to': { selected: '192.168.1.22:11002' },
        },
      },
    });

    expect(result).toEqual([
      { key: 'vic', label: 'VIC', state: 'ON', ip: '192.168.1.20', port: '11000' },
      { key: 'audio', label: 'Audio', state: 'ON', ip: '192.168.1.21', port: '11001' },
      { key: 'debug', label: 'Debug', state: 'ON', ip: '192.168.1.22', port: '11002' },
    ]);
  });

  it('uses OFF defaults for missing or disabled streams', () => {
    const result = buildStreamStatusEntries({
      'Data Streams': {
        items: {
          'Stream VIC to': { selected: 'off' },
          'Stream Audio to': { selected: '' },
        },
      },
    });

    expect(result[0]).toEqual({ key: 'vic', label: 'VIC', state: 'OFF', ip: '—', port: '—' });
    expect(result[1]).toEqual({ key: 'audio', label: 'Audio', state: 'OFF', ip: '—', port: '—' });
    expect(result[2]).toEqual({ key: 'debug', label: 'Debug', state: 'OFF', ip: '—', port: '—' });
  });

  it('applies default port when target omits one', () => {
    const result = buildStreamStatusEntries({
      'Data Streams': {
        items: {
          'Stream VIC to': { selected: '239.0.1.64' },
        },
      },
    });

    expect(result[0]).toEqual({
      key: 'vic',
      label: 'VIC',
      state: 'ON',
      ip: '239.0.1.64',
      port: '11000',
    });
  });
});
