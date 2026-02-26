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
let diagnosticsSummary = {
  rest: { total: 10, failed: 2, severity: 'medium' },
  ftp: { total: 4, failed: 1, severity: 'low' },
  logIssues: { total: 8, issues: 3, severity: 'high' },
};

const discoverConnection = vi.fn();
const saveConfiguredHostAndRetry = vi.fn();
const requestDiagnosticsOpen = vi.fn();

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

vi.mock('@/hooks/useConnectionDiagnosticsSummary', () => ({
  useConnectionDiagnosticsSummary: () => diagnosticsSummary,
}));

vi.mock('@/lib/diagnostics/diagnosticsOverlay', () => ({
  requestDiagnosticsOpen: (...args: unknown[]) => requestDiagnosticsOpen(...args),
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
    diagnosticsSummary = {
      rest: { total: 10, failed: 2, severity: 'medium' },
      ftp: { total: 4, failed: 1, severity: 'low' },
      logIssues: { total: 8, issues: 3, severity: 'high' },
    };
    lastProbeAtMs = null;
    lastProbeSucceededAtMs = null;
    lastProbeFailedAtMs = null;
    requestDiagnosticsOpen.mockReset();
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

    const { getByTestId, getByRole, getByLabelText, queryByTestId } = render(<ConnectivityIndicator />);
    fireEvent.click(getByTestId('connectivity-indicator'));
    fireEvent.click(getByRole('button', { name: 'Change' }));
    fireEvent.change(getByLabelText('C64U Hostname / IP'), { target: { value: '192.168.0.20' } });
    fireEvent.click(getByRole('button', { name: 'Save' }));

    expect(saveConfiguredHostAndRetry).toHaveBeenCalledWith('192.168.0.20', '192.168.0.10', { trigger: 'settings' });
    expect(queryByTestId('connection-status-popover')).toBeNull();
  });

  it('saves host when Enter is pressed', () => {
    connectionState = 'OFFLINE_NO_DEMO';
    configuredHost = '192.168.0.11';
    const { getByTestId, getByRole, getByLabelText } = render(<ConnectivityIndicator />);
    fireEvent.click(getByTestId('connectivity-indicator'));
    fireEvent.click(getByRole('button', { name: 'Change' }));
    const input = getByLabelText('C64U Hostname / IP');
    fireEvent.change(input, { target: { value: '192.168.0.12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(saveConfiguredHostAndRetry).toHaveBeenCalledWith('192.168.0.12', '192.168.0.11', { trigger: 'settings' });
  });

  it('renders diagnostics rows with one indicator each and opens diagnostics tabs', () => {
    const { getByTestId } = render(<ConnectivityIndicator />);
    fireEvent.click(getByTestId('connectivity-indicator'));

    const section = getByTestId('connection-diagnostics-section');
    expect(section).toBeTruthy();
    const restRow = getByTestId('connection-diagnostics-row-rest');
    const ftpRow = getByTestId('connection-diagnostics-row-ftp');
    const logIssuesRow = getByTestId('connection-diagnostics-row-log-issues');
    expect(getByTestId('connection-diagnostics-row-rest-indicator')).toBeTruthy();
    expect(getByTestId('connection-diagnostics-row-ftp-indicator')).toBeTruthy();
    expect(getByTestId('connection-diagnostics-row-log-issues-indicator')).toBeTruthy();
    expect(restRow.textContent).toContain('REST');
    expect(restRow.textContent).toContain('2');
    expect(ftpRow.textContent).toContain('FTP');
    expect(logIssuesRow.textContent).toContain('Log issues');

    fireEvent.click(restRow);
    expect(requestDiagnosticsOpen).toHaveBeenCalledWith('actions');
  });
});
