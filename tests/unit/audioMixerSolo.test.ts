/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSoloRoutingUpdates,
  isSidVolumeName,
  resolveAudioMixerMuteValue,
  soloReducer,
  type SoloState,
} from '@/lib/config/audioMixerSolo';

describe('audio mixer solo routing', () => {
  const options = ['OFF', '+6 dB', ' 0 dB', '-6 dB'];
  const items = [
    { name: 'Vol UltiSid 1', value: ' 0 dB', options },
    { name: 'Vol UltiSid 2', value: '+6 dB', options },
    { name: 'Vol Socket 1', value: '-6 dB', options },
    { name: 'Vol Socket 2', value: '+6 dB', options },
  ];

  it('identifies SID volume names', () => {
    expect(isSidVolumeName('Vol UltiSid 1')).toBe(true);
    expect(isSidVolumeName('Vol Socket 2')).toBe(true);
    expect(isSidVolumeName('Pan Socket 1')).toBe(false);
  });

  it('resolves mute values from options', () => {
    expect(resolveAudioMixerMuteValue(options)).toBe('OFF');
    expect(resolveAudioMixerMuteValue(['-12 dB', '-6 dB'])).toBe('-12 dB');
  });

  it('enforces single-solo toggling', () => {
    const initial: SoloState = { soloItem: null };
    const afterFirst = soloReducer(initial, {
      type: 'toggle',
      item: 'Vol UltiSid 1',
    });
    expect(afterFirst.soloItem).toBe('Vol UltiSid 1');
    const switched = soloReducer(afterFirst, {
      type: 'toggle',
      item: 'Vol Socket 1',
    });
    expect(switched.soloItem).toBe('Vol Socket 1');
    const cleared = soloReducer(switched, {
      type: 'toggle',
      item: 'Vol Socket 1',
    });
    expect(cleared.soloItem).toBeNull();
  });

  it('computes effective volumes with and without solo', () => {
    const noSolo = buildSoloRoutingUpdates(items, null);
    expect(noSolo).toEqual({
      'Vol UltiSid 1': ' 0 dB',
      'Vol UltiSid 2': '+6 dB',
      'Vol Socket 1': '-6 dB',
      'Vol Socket 2': '+6 dB',
    });

    const soloed = buildSoloRoutingUpdates(items, 'Vol Socket 1');
    expect(soloed['Vol Socket 1']).toBe('-6 dB');
    expect(soloed['Vol UltiSid 1']).toBe('OFF');
    expect(soloed['Vol UltiSid 2']).toBe('OFF');
    expect(soloed['Vol Socket 2']).toBe('OFF');
  });

  it('resets solo state', () => {
    const active: SoloState = { soloItem: 'Vol UltiSid 2' };
    const reset = soloReducer(active, { type: 'reset' });
    expect(reset.soloItem).toBeNull();
  });

  it('resolveAudioMixerMuteValue returns OFF for empty options (line 36)', () => {
    expect(resolveAudioMixerMuteValue([])).toBe('OFF');
    expect(resolveAudioMixerMuteValue()).toBe('OFF');
  });

  it('resolveAudioMixerMuteValue falls back to first option when none are numeric (line 32 FALSE)', () => {
    expect(resolveAudioMixerMuteValue(['ON', 'HIGH', 'LOW'])).toBe('ON');
  });

  it('resolveAudioMixerMuteValue picks lower numeric option (line 48 FALSE branch)', () => {
    // '5' starts as min; '10' is compared and 10<5 is FALSE, keeping 5 as min
    expect(resolveAudioMixerMuteValue(['5', '10'])).toBe('5');
  });

  it('resolveAudioMixerMuteValue finds new minimum when later option is smaller (BRDA:48 TRUE)', () => {
    // '10' starts as min; '5' is compared and 5<10 is TRUE → entry becomes new min
    expect(resolveAudioMixerMuteValue(['10', '5'])).toBe('5');
  });

  it('buildSoloRoutingUpdates skips non-SID-volume items (line 69)', () => {
    const updates = buildSoloRoutingUpdates(
      [{ name: 'master', value: '0 dB', options: ['0 dB', '-6 dB'] }],
      null,
    );
    expect(Object.keys(updates)).toHaveLength(0);
  });
});
