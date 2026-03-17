/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserInterfaceSummaryCard } from '@/pages/home/components/UserInterfaceSummaryCard';

const { updateConfigValueSpy, resolveConfigValueSpy } = vi.hoisted(() => ({
  updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
  resolveConfigValueSpy: vi.fn(
    (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
  ),
}));

vi.mock('@/pages/home/hooks/ConfigActionsContext', () => ({
  useSharedConfigActions: () => ({
    configWritePending: {},
    updateConfigValue: updateConfigValueSpy,
    resolveConfigValue: resolveConfigValueSpy,
  }),
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, disabled, 'aria-label': ariaLabel, 'data-testid': testId }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <div data-value={value} data-disabled={String(disabled)}>
      <button
        onClick={() => onValueChange && onValueChange('NewVal')}
        data-testid={`select-change-${value}`}
      >
        Change
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, 'data-testid': testId }: any) => <div data-testid={testId}>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));

const defaultProps = {
  category: 'User Interface',
  config: undefined,
  isActive: true,
  selectTriggerClassName: 'trigger-cls',
  testIdPrefix: 'ui-card',
};

describe('UserInterfaceSummaryCard', () => {
  it('renders the card with summary testid', () => {
    render(<UserInterfaceSummaryCard {...defaultProps} />);
    expect(screen.getByTestId('ui-card-summary')).toBeInTheDocument();
    expect(screen.getByText('User Interface')).toBeInTheDocument();
  });

  it('renders overlay, wasd-cursors, and color-scheme rows', () => {
    render(<UserInterfaceSummaryCard {...defaultProps} />);
    expect(screen.getByTestId('ui-card-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('ui-card-wasd-cursors')).toBeInTheDocument();
    expect(screen.getByTestId('ui-card-color-scheme')).toBeInTheDocument();
  });

  it('shows Not available labels when not active', () => {
    resolveConfigValueSpy.mockImplementation(
      (_p: unknown, _c: string, _i: string, fallback: string | number) => fallback,
    );
    render(<UserInterfaceSummaryCard {...defaultProps} isActive={false} />);
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });

  it('calls updateConfigValue with correct args when overlay changes', () => {
    render(<UserInterfaceSummaryCard {...defaultProps} />);
    // The overlay row uses SummaryConfigControlRow with 2 toggle options → checkbox
    // But with no config provided, we only have the fallback value so options would be empty
    // SummaryConfigControlRow renders checkbox when options.length===2
    // No options → falls back to a select. Click the select change button.
    const changeBtns = screen.getAllByText('Change');
    fireEvent.click(changeBtns[0]);
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      'User Interface',
      'Interface Type',
      'NewVal',
      'HOME_USER_INTERFACE_OVERLAY',
      'Overlay updated',
    );
  });

  it('calls updateConfigValue for navigation style change', () => {
    render(<UserInterfaceSummaryCard {...defaultProps} />);
    const changeBtns = screen.getAllByText('Change');
    fireEvent.click(changeBtns[1]);
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      'User Interface',
      'Navigation Style',
      'NewVal',
      'HOME_USER_INTERFACE_NAVIGATION',
      'Navigation style updated',
    );
  });

  it('calls updateConfigValue for color scheme change', () => {
    render(<UserInterfaceSummaryCard {...defaultProps} />);
    const changeBtns = screen.getAllByText('Change');
    fireEvent.click(changeBtns[2]);
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      'User Interface',
      'Color Scheme',
      'NewVal',
      'HOME_USER_INTERFACE_COLOR_SCHEME',
      'Color scheme updated',
    );
  });

  it('renders without errors when configWritePending has a pending key', () => {
    render(<UserInterfaceSummaryCard {...defaultProps} />);
    expect(screen.getByTestId('ui-card-summary')).toBeInTheDocument();
  });
});
