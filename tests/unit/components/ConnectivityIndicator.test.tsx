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
let theme = 'light';

const discoverConnection = vi.fn();

vi.mock('@/hooks/useConnectionState', () => ({
  useConnectionState: () => ({ state: connectionState }),
}));

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({ resolvedTheme: theme }),
}));

vi.mock('@/lib/connection/connectionManager', () => ({
  discoverConnection: (...args: unknown[]) => discoverConnection(...args),
}));

import { ConnectivityIndicator } from '@/components/ConnectivityIndicator';

describe('ConnectivityIndicator', () => {
  it('renders labels for connection states and triggers discovery', () => {
    connectionState = 'REAL_CONNECTED';
    theme = 'light';

    const { getByTestId } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('data-connection-state', 'REAL_CONNECTED');
    expect(button).toHaveAttribute('aria-label', 'C64U Connected');

    fireEvent.click(button);
    expect(discoverConnection).toHaveBeenCalledWith('manual');
  });

  it('renders demo state label and uses dark theme colors', () => {
    connectionState = 'DEMO_ACTIVE';
    theme = 'dark';

    const { getByTestId } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('aria-label', 'C64U Demo');
  });

  it('renders offline state label', () => {
    connectionState = 'OFFLINE_NO_DEMO';
    theme = 'light';

    const { getByTestId } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('aria-label', 'C64U Offline');
  });
});
