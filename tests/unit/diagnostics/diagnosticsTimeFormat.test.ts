import { describe, expect, it } from 'vitest';
import { formatDiagnosticsTimestamp, splitDiagnosticsTimestamp } from '@/lib/diagnostics/timeFormat';

describe('diagnostics time formatting', () => {
  it('formats the same timestamp across input types', () => {
    const date = new Date('2024-01-01T02:03:04.005Z');
    const fromDate = formatDiagnosticsTimestamp(date);
    const fromString = formatDiagnosticsTimestamp(date.toISOString());
    const fromNumber = formatDiagnosticsTimestamp(date.getTime());

    expect(fromDate).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(fromDate).toBe(fromString);
    expect(fromDate).toBe(fromNumber);
  });

  it('returns a stable placeholder for missing or invalid values', () => {
    expect(formatDiagnosticsTimestamp(null)).toBe('--:--:--.---');
    expect(formatDiagnosticsTimestamp(undefined)).toBe('--:--:--.---');
    expect(formatDiagnosticsTimestamp('not-a-date')).toBe('--:--:--.---');
  });

  it('splits timestamps into base and milliseconds', () => {
    const date = new Date('2024-01-01T02:03:04.005Z');
    const parts = splitDiagnosticsTimestamp(date);
    expect(parts.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(parts.millis).toMatch(/^\d{3}$/);

    const placeholder = splitDiagnosticsTimestamp(null);
    expect(placeholder.time).toBe('--:--:--');
    expect(placeholder.millis).toBe('---');
  });
});
