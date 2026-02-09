/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAudioMixerValueEqual,
  mergeAudioMixerOptions,
  normalizeAudioMixerValue,
  resolveAudioMixerResetValue,
} from '@/lib/config/audioMixer';

const mockApi = {
  getConfigItem: vi.fn(),
};

vi.mock('@/lib/c64api', () => ({
  getC64API: () => mockApi,
}));

describe('mergeAudioMixerOptions', () => {
  beforeEach(() => {
    mockApi.getConfigItem.mockReset();
  });
  it('merges options and presets while de-duplicating', () => {
    const options = [' 0 dB', 'OFF'];
    const presets = ['+6 dB', 'off', ' 0 dB'];

    expect(mergeAudioMixerOptions(options, presets)).toEqual([' 0 dB', 'OFF', '+6 dB']);
  });

  it('ignores empty values', () => {
    const options = [' ', '0 dB'];
    const presets = ['\n', ''];

    expect(mergeAudioMixerOptions(options, presets)).toEqual(['0 dB']);
  });

  it('normalizes audio mixer values', () => {
    expect(normalizeAudioMixerValue(undefined)).toBeUndefined();
    expect(normalizeAudioMixerValue(3)).toBe(3);
    expect(normalizeAudioMixerValue(' Center ')).toBe('center');
    expect(normalizeAudioMixerValue('+6 dB')).toBe(6);
    expect(normalizeAudioMixerValue('OFF')).toBe('off');
  });

  it('compares mixer values using normalization rules', () => {
    expect(isAudioMixerValueEqual('0 dB', 0)).toBe(true);
    expect(isAudioMixerValueEqual('Center', 'center')).toBe(true);
    expect(isAudioMixerValueEqual('OFF', '0 dB')).toBe(false);
  });

  it('resolves reset values using provided options', async () => {
    await expect(resolveAudioMixerResetValue('Audio Mixer', 'Vol UltiSid 1', ['-6 dB', '0 dB'])).resolves.toBe('0 dB');
    await expect(resolveAudioMixerResetValue('Audio Mixer', 'Pan 1', ['Left', 'Center', 'Right'])).resolves.toBe('Center');
    await expect(resolveAudioMixerResetValue('Audio Mixer', 'Other', ['A', 'B'])).resolves.toBeUndefined();
  });

  it('resolves reset values from API when options are missing', async () => {
    mockApi.getConfigItem.mockResolvedValue({
      items: {
        'Vol UltiSid 1': {
          options: ['-6 dB', '0 dB'],
        },
        'Pan 1': {
          details: {
            presets: ['Left', 'Center'],
          },
        },
      },
    });

    await expect(resolveAudioMixerResetValue('Audio Mixer', 'Vol UltiSid 1')).resolves.toBe('0 dB');
    await expect(resolveAudioMixerResetValue('Audio Mixer', 'Pan 1')).resolves.toBe('Center');
  });

  it('falls back to defaults when API lookup fails', async () => {
    mockApi.getConfigItem.mockRejectedValue(new Error('boom'));

    await expect(resolveAudioMixerResetValue('Audio Mixer', 'Vol UltiSid 1')).resolves.toBe(0);
    await expect(resolveAudioMixerResetValue('Audio Mixer', 'Pan 1')).resolves.toBe('Center');
  });
});
