import { describe, expect, it } from 'vitest';
import { diskGroupColors, pickDiskGroupColor } from '@/lib/disks/diskGroupColors';

describe('diskGroupColors', () => {
  it('returns a stable color for the same value', () => {
    const first = pickDiskGroupColor('Action Pack');
    const second = pickDiskGroupColor('Action Pack');
    expect(first).toEqual(second);
  });

  it('returns a color entry for any input', () => {
    const result = pickDiskGroupColor('');
    expect(diskGroupColors).toContainEqual(result);
  });
});
