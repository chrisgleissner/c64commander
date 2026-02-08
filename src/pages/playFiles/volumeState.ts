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
