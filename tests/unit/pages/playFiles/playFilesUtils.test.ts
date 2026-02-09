import {
  formatTime,
  formatBytes,
  formatDate,
  isSongCategory,
  normalizeLocalPath,
  getLocalFilePath,
  parseDurationInput,
  clampDurationSeconds,
  formatDurationSeconds,
  durationSecondsToSlider,
  sliderToDurationSeconds,
  parseVolumeOption,
  parseModifiedAt,
  extractAudioMixerItems,
  shuffleArray,
  DURATION_MIN_SECONDS,
  DURATION_MAX_SECONDS,
} from '@/pages/playFiles/playFilesUtils';
import { mergeAudioMixerOptions } from '@/lib/config/audioMixer';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/config/audioMixer', () => ({
  mergeAudioMixerOptions: vi.fn(),
}));
vi.mock('@/lib/config/normalizeConfigItem', () => ({
  normalizeConfigItem: vi.fn(),
}));

describe('playFilesUtils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

  describe('formatTime', () => {
    it('formats milliseconds to MM:SS', () => {
      expect(formatTime(1000)).toBe('0:01');
      expect(formatTime(65000)).toBe('1:05');
      expect(formatTime(3600000)).toBe('60:00');
    });
    it('handles undefined', () => {
        expect(formatTime(undefined)).toBe('—');
    });
  });
  
  describe('formatBytes', () => {
      it('formats bytes', () => {
          expect(formatBytes(10)).toBe('10 B');
          expect(formatBytes(1024)).toBe('1.0 KB');
          expect(formatBytes(1536)).toBe('1.5 KB');
      });
      it('handles null/undefined/negative', () => {
          expect(formatBytes(null)).toBe('—');
          expect(formatBytes(undefined)).toBe('—');
          expect(formatBytes(-1)).toBe('—');
      });
  });

  describe('formatDate', () => {
      it('formats valid date string', () => {
          const formatted = formatDate('2023-01-01T12:00:00Z');
          expect(formatted).not.toBe('—');
      });
      it('handles invalid', () => {
          expect(formatDate(null)).toBe('—');
          expect(formatDate('invalid')).toBe('—');
      });
  });

  describe('isSongCategory', () => {
      it('identifies songs', () => {
          expect(isSongCategory('sid')).toBe(true);
          expect(isSongCategory('mod')).toBe(true);
          expect(isSongCategory('prg')).toBe(false);
      });
  });

  describe('normalizeLocalPath', () => {
      it('prepends slash if missing', () => {
          expect(normalizeLocalPath('foo')).toBe('/foo');
          expect(normalizeLocalPath('/foo')).toBe('/foo');
      });
  });

  describe('getLocalFilePath', () => {
      it('uses webkitRelativePath if available', () => {
          const file = { webkitRelativePath: 'path/to/file' } as any;
          expect(getLocalFilePath(file)).toBe('/path/to/file');
      });
      it('fallbacks to name', () => {
          const file = { name: 'file.d64' } as any;
          expect(getLocalFilePath(file)).toBe('/file.d64');
      });
  });

  describe('parseDurationInput', () => {
      it('parses MM:SS', () => {
          expect(parseDurationInput('1:05')).toBe(65000);
      });
      it('parses seconds', () => {
          expect(parseDurationInput('65')).toBe(65000);
      });
      it('handles invalid', () => {
          expect(parseDurationInput('invalid')).toBeUndefined();
          expect(parseDurationInput('1:invalid')).toBeUndefined();
          expect(parseDurationInput('1:100')).toBeUndefined(); // Seconds >= 60 invalid in strict time?
      });
  });

  describe('sliders', () => {
       it('clamps duration', () => {
           expect(clampDurationSeconds(0)).toBe(DURATION_MIN_SECONDS);
           expect(clampDurationSeconds(100000)).toBe(DURATION_MAX_SECONDS);
       });
       
       it('converts to/from slider', () => {
            const seconds = 60;
            const slider = durationSecondsToSlider(seconds);
            const convertedBack = sliderToDurationSeconds(slider);
            // expect close enough due to rounding steps
            expect(Math.abs(convertedBack - seconds)).toBeLessThan(5);
       });
       
       it('formatDurationSeconds', () => {
           expect(formatDurationSeconds(60)).toBe('1:00');
       });
  });

  describe('parseVolumeOption', () => {
      it('parses number from string', () => {
          expect(parseVolumeOption('Value 10.5')).toBe(10.5);
          expect(parseVolumeOption('No number')).toBeUndefined();
      });
  });
  
  describe('parseModifiedAt', () => {
      it('parses date string', () => {
          expect(parseModifiedAt('2023-01-01')).toBeDefined();
      });
      it('handles invalid', () => {
           expect(parseModifiedAt(undefined)).toBeUndefined();
           expect(parseModifiedAt('invalid')).toBeUndefined();
      });
  });

  describe('extractAudioMixerItems', () => {
      it('extracts items', () => {
          const payload = {
              'Audio Mixer': {
                  items: {
                      'Item 1': { value: 10 }
                  }
              }
          };
          vi.mocked(normalizeConfigItem).mockReturnValue({ value: 10, options: ['a'] } as any);
          vi.mocked(mergeAudioMixerOptions).mockReturnValue(['a']);

          const result = extractAudioMixerItems(payload);
          expect(result).toHaveLength(1);
          expect(result[0].name).toBe('Item 1');
      });

      it('handles empty payload', () => {
           expect(extractAudioMixerItems(undefined)).toEqual([]);
           expect(extractAudioMixerItems({})).toEqual([]);
      });
  });

  describe('shuffleArray', () => {
      it('shuffles', () => {
           const arr = [1, 2, 3, 4, 5];
           const shuffled = shuffleArray(arr);
           expect(shuffled).toHaveLength(5);
           expect(shuffled).toContain(1);
           expect(shuffled).not.toBe(arr); // New array
      });
      
      it('shuffles single element', () => {
          expect(shuffleArray([1])).toEqual([1]);
      });
  });
});
