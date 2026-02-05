import { describe, expect, it } from 'vitest';
import { formatBuildInfo, formatBuildTimeUtc } from '@/lib/buildInfo';

describe('buildInfo', () => {
    it('formats build time in UTC', () => {
        const result = formatBuildTimeUtc('2026-02-05T12:34:56.789Z');
        expect(result).toBe('2026-02-05 12:34:56 UTC');
    });

    it('returns placeholders for missing or invalid input', () => {
        expect(formatBuildTimeUtc('')).toBe('2026-01-01 12:00:00 UTC');
        expect(formatBuildTimeUtc('not-a-date')).toBe('2026-01-01 12:00:00 UTC');
    });

    it('builds version and sha labels', () => {
        const info = formatBuildInfo({
            appVersion: '1.2.3-abcdef12',
            gitSha: 'abcdef1234567890',
            buildTime: '2026-02-05T01:02:03Z',
        });

        expect(info.versionLabel).toBe('1.2.3-abcdef12');
        expect(info.gitShaShort).toBe('abcdef12');
        expect(info.buildTimeUtc).toBe('2026-02-05 01:02:03 UTC');
    });
});
