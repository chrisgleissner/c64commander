import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Slider } from './slider';

describe('Slider value display', () => {
    it('shows value on pointer down and hides on release', () => {
        render(
            <Slider
                value={[50]}
                min={0}
                max={100}
                step={1}
                data-testid="test-slider"
            />,
        );

        const root = screen.getByTestId('test-slider');
        expect(screen.queryByTestId('slider-value-display')).toBeNull();
        fireEvent.pointerDown(root);
        expect(screen.getByTestId('slider-value-display')).toBeTruthy();

        fireEvent.pointerUp(root);
        expect(screen.queryByTestId('slider-value-display')).toBeNull();
    });
});
