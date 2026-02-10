
import { describe, it, expect } from 'vitest';
import { reduceVolumeState, type VolumeState } from '@/pages/playFiles/volumeState';

describe('reduceVolumeState', () => {
    const baseState: VolumeState = { index: 10, muted: false, reason: null };

    it('handles reset', () => {
        const result = reduceVolumeState(baseState, { type: 'reset', index: 5 });
        expect(result).toEqual({ index: 5, muted: false, reason: null });
    });

    it('handles sync', () => {
        const result = reduceVolumeState(baseState, { type: 'sync', index: 8, muted: true });
        expect(result).toEqual({ index: 8, muted: true, reason: 'sync' });
    });

    it('handles set-index', () => {
        const result = reduceVolumeState(baseState, { type: 'set-index', index: 2 });
        expect(result).toEqual({ ...baseState, index: 2 });
    });

    it('handles mute', () => {
        // Reason manual
        const r1 = reduceVolumeState(baseState, { type: 'mute', reason: 'manual' });
        expect(r1).toEqual({ ...baseState, muted: true, reason: 'manual' });
        // Reason pause
        const r2 = reduceVolumeState(baseState, { type: 'mute', reason: 'pause' });
        expect(r2).toEqual({ ...baseState, muted: true, reason: 'pause' });
    });

    it('handles unmute with reason logic', () => {
        const mutedState: VolumeState = { index: 5, muted: true, reason: 'pause' };
        // Unmute manual
        const r1 = reduceVolumeState(mutedState, { type: 'unmute', reason: 'manual' });
        expect(r1).toEqual({ index: 5, muted: false, reason: 'manual' });

        // Unmute sync
        const r2 = reduceVolumeState(mutedState, { type: 'unmute', reason: 'sync' });
        expect(r2).toEqual({ index: 5, muted: false, reason: 'sync' });

        // Unmute with index update
        const r3 = reduceVolumeState(mutedState, { type: 'unmute', reason: 'manual', index: 9 });
        expect(r3).toEqual({ index: 9, muted: false, reason: 'manual' });
    });

    it('handles unknown action', () => {
        // @ts-ignore
        const result = reduceVolumeState(baseState, { type: 'UNKNOWN' });
        expect(result).toBe(baseState);
    });
});
