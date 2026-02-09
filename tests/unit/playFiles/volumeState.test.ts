/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { reduceVolumeState, type VolumeState } from '@/pages/playFiles/volumeState';

describe('reduceVolumeState', () => {
    const base: VolumeState = { index: 2, muted: false, reason: null };

    it('syncs to the device index and mute state', () => {
        const next = reduceVolumeState(base, { type: 'sync', index: 4, muted: true });
        expect(next).toEqual({ index: 4, muted: true, reason: 'sync' });
    });

    it('tracks manual mute and unmute transitions', () => {
        const muted = reduceVolumeState(base, { type: 'mute', reason: 'manual' });
        expect(muted).toEqual({ index: 2, muted: true, reason: 'manual' });
        const unmuted = reduceVolumeState(muted, { type: 'unmute', reason: 'manual', index: 1 });
        expect(unmuted).toEqual({ index: 1, muted: false, reason: 'manual' });
    });

    it('resets to an unmuted baseline index', () => {
        const muted = reduceVolumeState(base, { type: 'mute', reason: 'pause' });
        const reset = reduceVolumeState(muted, { type: 'reset', index: 0 });
        expect(reset).toEqual({ index: 0, muted: false, reason: null });
    });
});
