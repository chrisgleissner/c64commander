/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type VolumeState = {
    index: number;
    muted: boolean;
    reason: 'manual' | 'pause' | 'sync' | null;
};

export type VolumeAction =
    | { type: 'reset'; index: number }
    | { type: 'sync'; index: number; muted: boolean }
    | { type: 'set-index'; index: number }
    | { type: 'mute'; reason: 'manual' | 'pause' }
    | { type: 'unmute'; reason: 'manual' | 'pause' | 'sync'; index?: number };

export const reduceVolumeState = (state: VolumeState, action: VolumeAction): VolumeState => {
    switch (action.type) {
        case 'reset':
            return { index: action.index, muted: false, reason: null };
        case 'sync':
            return { index: action.index, muted: action.muted, reason: 'sync' };
        case 'set-index':
            return { ...state, index: action.index };
        case 'mute':
            return { ...state, muted: true, reason: action.reason };
        case 'unmute':
            return {
                index: action.index ?? state.index,
                muted: false,
                reason: action.reason,
            };
        default:
            return state;
    }
};
