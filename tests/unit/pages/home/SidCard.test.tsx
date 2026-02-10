/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SidCard, type SidCardProps } from '@/pages/home/SidCard';

// Mock UI components
vi.mock('@/components/ui/button', () => ({
    Button: ({ children, onClick, disabled }: any) => (
        <button data-testid="button" onClick={onClick} disabled={disabled}>
            {children}
        </button>
    )
}));

vi.mock('@/components/ui/slider', () => ({
    Slider: ({ value, onValueChange, onValueCommit, disabled, midpoint }: any) => (
        <div data-testid="slider" data-value={value[0]} data-midpoint={midpoint ? 'true' : 'false'}>
            <input 
                type="range" 
                value={value[0]} 
                onChange={(e) => onValueChange([Number(e.target.value)])} 
                onMouseUp={(e) => onValueCommit && onValueCommit([Number((e.target as HTMLInputElement).value)])}
                disabled={disabled}
            />
        </div>
    )
}));

vi.mock('@/components/ui/select', () => ({
    Select: ({ children, value, onValueChange, disabled }: any) => (
        <div data-testid="select" data-value={value} data-disabled={disabled}>
            <button onClick={() => onValueChange && onValueChange('opt1')}>Change</button>
            {children}
        </div>
    ),
    SelectTrigger: ({ children }: any) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));

describe('SidCard', () => {
    const defaultProps: SidCardProps = {
        name: 'SID 1',
        power: true,
        onPowerToggle: vi.fn(),
        identityLabel: 'SID Model',
        identityValue: '8580',
        identityOptions: ['6581', '8580', ''],
        onIdentityChange: vi.fn(),
        addressValue: 'd400',
        addressOptions: ['d400', 'de00'],
        onAddressChange: vi.fn(),
        shapingControls: [{ label: 'DigiBoost', value: 'On', options: ['On', 'Off'], onChange: vi.fn() }],
        volume: 15,
        volumeMax: 15,
        onVolumeChange: vi.fn(),
        volumeMidpoint: 0,
        pan: 0,
        panMax: 100,
        onPanChange: vi.fn(),
        panMidpoint: 50,
        isConnected: true,
        testIdSuffix: 'foo',
    };

    it('renders basic info', () => {
        render(<SidCard {...defaultProps} />);
        expect(screen.getByText('SID 1')).toBeDefined();
        expect(screen.getByText('ON')).toBeDefined();
        expect(screen.getByText('SID Model')).toBeDefined();
    });

    it('handles power toggle', () => {
        render(<SidCard {...defaultProps} power={false} />);
        fireEvent.click(screen.getByText('OFF'));
        expect(defaultProps.onPowerToggle).toHaveBeenCalled();
    });

    it('renders readonly power button if no toggle handler', () => {
        render(<SidCard {...defaultProps} onPowerToggle={undefined} />);
        const btn = screen.getByText('ON').closest('button');
        expect(btn).toBeDisabled();
    });
    
    it('renders readonly identity', () => {
         render(<SidCard {...defaultProps} isIdentityReadOnly={true} />);
         expect(screen.getByText('8580')).toBeDefined();
         expect(screen.getAllByTestId('select')).toHaveLength(2); // Address + Shaping
         
         // Identity val is 8580
         // Identity select value would be 8580 too.
         // But renders <span> identityValue </span>
    });

    it('handles identity formatting for empty option', () => {
         // Identity options include '' 
         // 'Default' text should appear in items
         render(<SidCard {...defaultProps} />);
         // Since we mock SelectContent/Item rendering, we can search for 'Default'
         expect(screen.getByText('Default')).toBeDefined();
    });

    it('renders shaping controls (editable)', () => {
        const onChange = vi.fn();
        render(<SidCard {...defaultProps} shapingControls={[{ label: 'Shape', value: 'V', options: ['V'], onChange }]} />);
        expect(screen.getByText('Shape')).toBeDefined();
        // Trigger change
        const buttons = screen.getAllByText('Change');
        // Index 2? (Identity, Address, Shaping)
        fireEvent.click(buttons[2]);
        expect(onChange).toHaveBeenCalledWith('opt1');
    });

    it('renders shaping controls (readonly)', () => {
         render(<SidCard {...defaultProps} shapingControls={[{ label: 'Shape', value: 'V' }]} />); // No options/onChange
         expect(screen.getByText('V')).toBeDefined();
         expect(screen.queryAllByTestId('select')).toHaveLength(2); // Identity + Address only
    });

    it('handles volume interaction', () => {
        const commit = vi.fn();
        const change = vi.fn();
        const { rerender } = render(<SidCard {...defaultProps} onVolumeCommit={commit} onVolumeChange={change} />);
        const sliders = screen.getAllByTestId('slider');
        const volSlider = sliders[0]; // First one is volume
        const input = volSlider.querySelector('input')!;
        
        fireEvent.change(input, { target: { value: '10' } });
        expect(change).toHaveBeenCalledWith(10);
        
        // Update props to reflect change for controlled component
        rerender(<SidCard {...defaultProps} volume={10} onVolumeCommit={commit} onVolumeChange={change} />);
        
        fireEvent.mouseUp(input);
        expect(commit).toHaveBeenCalledWith(10);
    });

    it('handles pan interaction', () => {
         const change = vi.fn();
         render(<SidCard {...defaultProps} onPanChange={change} />);
         const sliders = screen.getAllByTestId('slider');
         const panSlider = sliders[1]; 
         const input = panSlider.querySelector('input')!;
         
         fireEvent.change(input, { target: { value: '20' } });
         expect(change).toHaveBeenCalledWith(20);
    });
    
    it('disables controls when disconnected or pending', () => {
        render(<SidCard {...defaultProps} isConnected={false} />);
        const buttons = screen.getAllByTestId('button');
        expect(buttons[0]).toBeDisabled();
        
        const selects = screen.getAllByTestId('select');
        selects.forEach(s => expect(s.getAttribute('data-disabled')).toBe('true')); 
        // My mock: data-disabled={disabled}
        // render(<div data-disabled={false} />) -> attribute not present? or "false"?
        // React renders boolean attributes as presence. But data attributes stringify.
        // Let's check expectation.
    });

    it('checks midpoint props passed', () => {
        render(<SidCard {...defaultProps} volumeMidpoint={null} panMidpoint={50} />);
        const sliders = screen.getAllByTestId('slider');
        expect(sliders[0].getAttribute('data-midpoint')).toBe('false'); // Volume
        expect(sliders[1].getAttribute('data-midpoint')).toBe('true'); // Pan
    });
});
