import { describe, expect, it } from 'vitest';
import { buildSidDetailEntries, parseSidBaseAddress } from '@/lib/config/sidDetails';

describe('sidDetails', () => {
  it('builds ordered SID detail entries with formatted values', () => {
    const entries = buildSidDetailEntries(
      {
        'Audio Mixer': {
          items: {
            'Vol Socket 1': { selected: ' 0 dB' },
            'Vol Socket 2': { selected: '+1 dB' },
            'Vol UltiSid 1': { selected: '-2 dB' },
            'Vol UltiSid 2': { selected: 'OFF' },
            'Pan Socket 1': { selected: 'Center' },
            'Pan Socket 2': { selected: 'Right 2' },
            'Pan UltiSID 1': { selected: 'Left 1' },
            'Pan UltiSID 2': { selected: 'Center' },
          },
        },
      },
      {
        'SID Addressing': {
          items: {
            'SID Socket 1 Address': { selected: '$d400' },
            'SID Socket 2 Address': { selected: '$d420' },
            'UltiSID 1 Address': { selected: 'Unmapped' },
            'UltiSID 2 Address': { selected: '$DFE0' },
          },
        },
      },
    );

    expect(entries.map((entry) => entry.label)).toEqual([
      'SID Socket 1',
      'SID Socket 2',
      'UltiSID 1',
      'UltiSID 2',
    ]);
    expect(entries[0]).toMatchObject({
      volume: '0 dB',
      pan: 'Center',
      address: '$D400',
    });
    expect(entries[1]).toMatchObject({
      volume: '+1 dB',
      pan: 'Right 2',
      address: '$D420',
    });
    expect(entries[2]).toMatchObject({
      volume: '-2 dB',
      pan: 'Left 1',
      address: 'Unmapped',
    });
  });

  it('parses mapped SID base addresses', () => {
    expect(parseSidBaseAddress('$D400')).toBe(0xd400);
    expect(parseSidBaseAddress('d420')).toBe(0xd420);
    expect(parseSidBaseAddress('Unmapped')).toBeNull();
    expect(parseSidBaseAddress('')).toBeNull();
    expect(parseSidBaseAddress('invalid')).toBeNull();
  });
});

