import { describe, expect, it } from 'vitest';
import { calculateHvscProgress } from '@/lib/hvsc/hvscProgress';

describe('calculateHvscProgress', () => {
  it('prefers explicit percent and clamps to range', () => {
    expect(calculateHvscProgress(5, 10, 120)).toBe(100);
    expect(calculateHvscProgress(5, 10, -5)).toBe(0);
  });

  it('calculates percent from counts', () => {
    expect(calculateHvscProgress(5, 10, null)).toBe(50);
    expect(calculateHvscProgress(1, 3, undefined)).toBe(33);
  });

  it('returns null when counts are missing', () => {
    expect(calculateHvscProgress(null, 10, null)).toBeNull();
    expect(calculateHvscProgress(5, null, null)).toBeNull();
    expect(calculateHvscProgress(5, 0, null)).toBeNull();
  });
});
