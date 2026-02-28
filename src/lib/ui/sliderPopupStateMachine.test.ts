import { describe, expect, it } from 'vitest';
import {
    reduceSliderPopupState,
    resolveSliderPopupCloseDelayMs,
    SLIDER_POPUP_IDLE_CLOSE_MS,
    SLIDER_POPUP_MIN_VISIBLE_MS,
    type SliderPopupState,
} from '@/lib/ui/sliderPopupStateMachine';

describe('sliderPopupStateMachine', () => {
    it('transitions through active, idle, closing, hidden', () => {
        let state: SliderPopupState = 'Hidden';
        state = reduceSliderPopupState(state, 'interaction-start');
        expect(state).toBe('VisibleActive');
        state = reduceSliderPopupState(state, 'interaction-end');
        expect(state).toBe('VisibleIdle');
        state = reduceSliderPopupState(state, 'idle-timeout');
        expect(state).toBe('Closing');
        state = reduceSliderPopupState(state, 'force-hide');
        expect(state).toBe('Hidden');
    });

    it('re-activates from idle when interaction resumes', () => {
        let state: SliderPopupState = 'VisibleIdle';
        state = reduceSliderPopupState(state, 'interaction-update');
        expect(state).toBe('VisibleActive');
    });

    it('computes close delay bounded by both idle and minimum visible windows', () => {
        const openedAt = 1_000;
        const lastInteractionAt = 1_200;
        const now = 1_250;
        const delay = resolveSliderPopupCloseDelayMs(openedAt, lastInteractionAt, now);
        expect(delay).toBe(Math.max((openedAt + SLIDER_POPUP_MIN_VISIBLE_MS) - now, (lastInteractionAt + SLIDER_POPUP_IDLE_CLOSE_MS) - now));
    });
});
