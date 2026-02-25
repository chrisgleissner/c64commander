/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

let connectionState = 'UNKNOWN';

const discoverConnection = vi.fn();

vi.mock('@/hooks/useConnectionState', () => ({
  useConnectionState: () => ({ state: connectionState }),
}));

vi.mock('@/lib/connection/connectionManager', () => ({
  discoverConnection: (...args: unknown[]) => discoverConnection(...args),
}));

import { ConnectivityIndicator } from '@/components/ConnectivityIndicator';

describe('ConnectivityIndicator', () => {
  it('renders labels for connection states and triggers discovery', () => {
    connectionState = 'REAL_CONNECTED';

    const { getByTestId } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('data-connection-state', 'REAL_CONNECTED');
    expect(button).toHaveAttribute('aria-label', 'C64U Connected');

    fireEvent.click(button);
    expect(discoverConnection).toHaveBeenCalledWith('manual');
  });

  it('renders demo state with demo label and success styling', () => {
    connectionState = 'DEMO_ACTIVE';

    const { getByTestId } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('aria-label', 'C64U Demo');
    expect(button).not.toHaveAttribute('aria-label', 'C64U Disconnected');

    // Demo mode must show the flask icon, not the monitor icon
    expect(getByTestId('demo-icon')).toBeTruthy();

    // Label must use success (green) styling, not muted (grey)
    const label = getByTestId('connection-status-label');
    expect(label.className).toContain('text-success');
    expect(label.className).not.toContain('text-muted-foreground');
  });

  it('renders offline state label with muted styling', () => {
    connectionState = 'OFFLINE_NO_DEMO';

    const { getByTestId } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('aria-label', 'C64U Offline');

    const label = getByTestId('connection-status-label');
    expect(label.className).toContain('text-muted-foreground');
    expect(label.className).not.toContain('text-success');
  });

  it('renders real-connected state with success styling', () => {
    connectionState = 'REAL_CONNECTED';

    const { getByTestId } = render(<ConnectivityIndicator />);

    const label = getByTestId('connection-status-label');
    expect(label.className).toContain('text-success');
    expect(label.className).not.toContain('text-muted-foreground');
  });
});
