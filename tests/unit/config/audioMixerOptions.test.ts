import { describe, expect, it } from 'vitest';
import { mergeAudioMixerOptions } from '@/lib/config/audioMixer';

describe('mergeAudioMixerOptions', () => {
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
});
