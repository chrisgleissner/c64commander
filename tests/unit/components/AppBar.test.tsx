/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppBar } from '@/components/AppBar';

const navigateMock = vi.fn();

vi.mock('react-router-dom', () => ({
    useNavigate: () => navigateMock,
}));

const requestDiagnosticsOpen = vi.fn();

vi.mock('@/lib/diagnostics/diagnosticsOverlay', () => ({
    requestDiagnosticsOpen: (...args: unknown[]) => requestDiagnosticsOpen(...args),
}));

vi.mock('@/components/DiagnosticsActivityIndicator', () => ({
    DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
        <button type="button" data-testid="diagnostics-activity-indicator" onClick={onClick} />
    ),
}));

vi.mock('@/components/ConnectivityIndicator', () => ({
    ConnectivityIndicator: () => <div data-testid="connectivity-indicator" />,
}));

describe('AppBar', () => {
    it('opens diagnostics actions when activity indicator is clicked', () => {
        render(<AppBar title="Test" />);

        fireEvent.click(screen.getByTestId('diagnostics-activity-indicator'));

        expect(requestDiagnosticsOpen).toHaveBeenCalledWith('actions');
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('renders activity indicator before connectivity indicator', () => {
        render(<AppBar title="Test" />);

        const activity = screen.getByTestId('diagnostics-activity-indicator');
        const connectivity = screen.getByTestId('connectivity-indicator');

        const position = activity.compareDocumentPosition(connectivity);
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('applies pt-safe class for Android status bar inset', () => {
        const { container } = render(<AppBar title="Test" />);

        const header = container.querySelector('header');
        expect(header).toHaveClass('pt-safe');
    });
});
