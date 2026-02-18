import { describe, expect, it } from 'vitest';
import { resolveVolumeSyncDecision, type VolumeUiTarget } from '@/pages/playFiles/playbackGuards';

describe('playbackGuards resolveVolumeSyncDecision', () => {
    it('applies sync when there is no pending ui target', () => {
        expect(resolveVolumeSyncDecision(null, 4, 1000)).toBe('apply');
    });

    it('clears pending target when incoming index matches reserved target', () => {
        const pending: VolumeUiTarget = { index: 5, setAtMs: 1000 };
        expect(resolveVolumeSyncDecision(pending, 5, 1200)).toBe('clear');
    });

    it('defers sync while stale competing value arrives before hold window expires', () => {
        const pending: VolumeUiTarget = { index: 6, setAtMs: 1000 };
        expect(resolveVolumeSyncDecision(pending, 3, 3400, 2500)).toBe('defer');
    });

    it('clears pending target when hold window expires for stale competing value', () => {
        const pending: VolumeUiTarget = { index: 6, setAtMs: 1000 };
        expect(resolveVolumeSyncDecision(pending, 3, 3500, 2500)).toBe('clear');
    });
});
