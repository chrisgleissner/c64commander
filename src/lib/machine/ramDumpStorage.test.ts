import { describe, expect, it } from 'vitest';
import { buildRamDumpFileName } from './ramDumpStorage';

describe('buildRamDumpFileName', () => {
    it('formats ISO timestamps without milliseconds', () => {
        const date = new Date('2024-01-02T03:04:05.678Z');
        expect(buildRamDumpFileName(date)).toBe('c64u-ram-2024-01-02T03-04-05Z.bin');
    });

    it('sanitizes optional context labels', () => {
        const date = new Date('2024-01-02T03:04:05.000Z');
        expect(buildRamDumpFileName(date, ' My Snapshot! ')).toBe(
            'c64u-ram-2024-01-02T03-04-05Z-my-snapshot.bin',
        );
        expect(buildRamDumpFileName(date, 'SIDE A / TEST')).toBe(
            'c64u-ram-2024-01-02T03-04-05Z-side-a-test.bin',
        );
    });
});
