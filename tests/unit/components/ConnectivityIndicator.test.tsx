/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

let connectionState = 'UNKNOWN';
let lastProbeAtMs: number | null = null;
let lastProbeSucceededAtMs: number | null = null;
let lastProbeFailedAtMs: number | null = null;
let configuredHost = '192.168.0.64';

const discoverConnection = vi.fn();
const saveConfiguredHostAndRetry = vi.fn();

vi.mock('@/hooks/useConnectionState', () => ({
  useConnectionState: () => ({
    state: connectionState,
    lastProbeAtMs,
    lastProbeSucceededAtMs,
    lastProbeFailedAtMs,
  }),
}));

vi.mock('@/lib/connection/connectionManager', () => ({
  discoverConnection: (...args: unknown[]) => discoverConnection(...args),
}));

vi.mock('@/lib/connection/hostEdit', () => ({
  getConfiguredHost: () => configuredHost,
  saveConfiguredHostAndRetry: (...args: unknown[]) => saveConfiguredHostAndRetry(...args),
}));

import { ConnectivityIndicator } from '@/components/ConnectivityIndicator';

describe('ConnectivityIndicator', () => {
  beforeEach(() => {
    discoverConnection.mockReset();
    saveConfiguredHostAndRetry.mockReset();
    connectionState = 'UNKNOWN';
    configuredHost = '192.168.0.64';
    lastProbeAtMs = null;
    lastProbeSucceededAtMs = null;
    lastProbeFailedAtMs = null;
  });

  it('renders real mode indicator and opens status pop-up on click', () => {
    connectionState = 'REAL_CONNECTED';
    lastProbeAtMs = Date.now() - 2_000;
    lastProbeSucceededAtMs = Date.now() - 2_000;
    lastProbeFailedAtMs = null;

    const { getByTestId, queryByText } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('data-connection-state', 'REAL_CONNECTED');
    expect(button).toHaveAttribute('aria-label', 'C64U');
    expect(getByTestId('connection-status-label').className).toContain('indicator-real');
    expect(queryByText('Demo')).toBeNull();

    fireEvent.click(button);
    expect(getByTestId('connection-status-popover')).toBeTruthy();
    expect(discoverConnection).not.toHaveBeenCalled();
  });

  it('renders demo mode with two lines and amber styling', () => {
    connectionState = 'DEMO_ACTIVE';
    lastProbeAtMs = Date.now() - 1_000;
    lastProbeSucceededAtMs = null;
    lastProbeFailedAtMs = Date.now() - 1_000;

    const { getByTestId } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');

    expect(button).toHaveAttribute('aria-label', 'C64U Demo');
    expect(button.textContent).toContain('C64U');
    expect(button.textContent).toContain('Demo');
    expect(getByTestId('connection-status-label').className).toContain('indicator-demo');
  });

  it('shows Retry Now only when offline or not yet connected', () => {
    connectionState = 'OFFLINE_NO_DEMO';
    lastProbeAtMs = Date.now() - 5_000;
    lastProbeSucceededAtMs = Date.now() - 20_000;
    lastProbeFailedAtMs = Date.now() - 5_000;

    const { getByTestId, getByRole, queryByRole, rerender } = render(<ConnectivityIndicator />);
    const button = getByTestId('connectivity-indicator');
    fireEvent.click(button);
    expect(getByRole('button', { name: 'Retry Now' })).toBeTruthy();

    connectionState = 'REAL_CONNECTED';
    lastProbeAtMs = Date.now() - 2_000;
    lastProbeSucceededAtMs = Date.now() - 2_000;
    lastProbeFailedAtMs = null;
    rerender(<ConnectivityIndicator />);
    fireEvent.click(getByTestId('connectivity-indicator'));
    expect(queryByRole('button', { name: 'Retry Now' })).toBeNull();
  });

  it('uses shared host-edit save flow from status pop-up', () => {
    connectionState = 'OFFLINE_NO_DEMO';
    lastProbeAtMs = Date.now() - 5_000;
    lastProbeSucceededAtMs = null;
    lastProbeFailedAtMs = Date.now() - 5_000;
    configuredHost = '192.168.0.10';

    const { getByTestId, getByRole, getByLabelText } = render(<ConnectivityIndicator />);
    fireEvent.click(getByTestId('connectivity-indicator'));
    fireEvent.click(getByRole('button', { name: 'Change' }));
    fireEvent.change(getByLabelText('C64U Hostname / IP'), { target: { value: '192.168.0.20' } });
    fireEvent.click(getByRole('button', { name: 'Save' }));

    expect(saveConfiguredHostAndRetry).toHaveBeenCalledWith('192.168.0.20', '192.168.0.10', { trigger: 'settings' });
  });
});
