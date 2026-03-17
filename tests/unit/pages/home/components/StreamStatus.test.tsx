/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreamStatus } from '@/pages/home/components/StreamStatus';

const { updateConfigValueSpy, handleStreamStartSpy, handleStreamStopSpy, handleStreamCommitSpy } = vi.hoisted(() => ({
  updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
  handleStreamStartSpy: vi.fn().mockResolvedValue(undefined),
  handleStreamStopSpy: vi.fn().mockResolvedValue(undefined),
  handleStreamCommitSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/pages/home/hooks/ConfigActionsContext', () => ({
  useSharedConfigActions: () => ({
    configWritePending: {},
    updateConfigValue: updateConfigValueSpy,
  }),
}));

vi.mock('@/hooks/useDisplayProfile', () => ({
  useDisplayProfile: () => ({ profile: 'medium' }),
}));

const mockStreamData = {
  streamControlEntries: [
    { key: 'sid', label: 'sid', ip: '192.168.1.1', port: '4422', itemName: 'SID Network' },
    { key: 'iec', label: 'iec', ip: '192.168.1.2', port: '4423', itemName: 'IEC Network' },
  ],
  streamDrafts: {},
  activeStreamEditorKey: null,
  streamEditorError: null,
  streamActionPending: {},
  handleStreamStart: handleStreamStartSpy,
  handleStreamStop: handleStreamStopSpy,
  handleStreamFieldChange: vi.fn(),
  handleStreamEditOpen: vi.fn(),
  handleStreamEditCancel: vi.fn(),
  handleStreamCommit: handleStreamCommitSpy,
};

vi.mock('@/pages/home/hooks/useStreamData', () => ({
  useStreamData: () => mockStreamData,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  },
}));

vi.mock('@/components/SectionHeader', () => ({
  SectionHeader: ({ title }: any) => <div>{title}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, 'data-testid': testId }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, 'data-testid': testId, disabled }: any) => (
    <input value={value} onChange={onChange} data-testid={testId} disabled={disabled} />
  ),
}));

describe('StreamStatus', () => {
  it('renders the Streams section header', () => {
    render(<StreamStatus isConnected={true} />);
    expect(screen.getByText('Streams')).toBeInTheDocument();
  });

  it('renders a row for each stream entry', () => {
    render(<StreamStatus isConnected={true} />);
    expect(screen.getByTestId('home-stream-row-sid')).toBeInTheDocument();
    expect(screen.getByTestId('home-stream-row-iec')).toBeInTheDocument();
  });

  it('renders Start and Stop buttons for each stream', () => {
    render(<StreamStatus isConnected={true} />);
    expect(screen.getByTestId('home-stream-start-sid')).toBeInTheDocument();
    expect(screen.getByTestId('home-stream-stop-sid')).toBeInTheDocument();
    expect(screen.getByTestId('home-stream-start-iec')).toBeInTheDocument();
    expect(screen.getByTestId('home-stream-stop-iec')).toBeInTheDocument();
  });

  it('displays the endpoint for each stream', () => {
    render(<StreamStatus isConnected={true} />);
    expect(screen.getByTestId('home-stream-endpoint-display-sid')).toBeInTheDocument();
    expect(screen.getByTestId('home-stream-endpoint-display-iec')).toBeInTheDocument();
  });

  it('disables buttons when isConnected=false', () => {
    render(<StreamStatus isConnected={false} />);
    expect(screen.getByTestId('home-stream-start-sid')).toBeDisabled();
    expect(screen.getByTestId('home-stream-stop-sid')).toBeDisabled();
  });

  it('calls handleStreamStart when Start is clicked', () => {
    render(<StreamStatus isConnected={true} />);
    fireEvent.click(screen.getByTestId('home-stream-start-sid'));
    expect(handleStreamStartSpy).toHaveBeenCalledWith('sid');
  });

  it('calls handleStreamStop when Stop is clicked', () => {
    render(<StreamStatus isConnected={true} />);
    fireEvent.click(screen.getByTestId('home-stream-stop-sid'));
    expect(handleStreamStopSpy).toHaveBeenCalledWith('sid');
  });

  it('does not show stream editor when activeStreamEditorKey is null', () => {
    render(<StreamStatus isConnected={true} />);
    expect(screen.queryByTestId('home-stream-endpoint-sid')).not.toBeInTheDocument();
  });

  it('shows stream editor when activeStreamEditorKey matches a stream', () => {
    mockStreamData.activeStreamEditorKey = 'sid' as any;
    render(<StreamStatus isConnected={true} />);
    expect(screen.getByTestId('home-stream-endpoint-sid')).toBeInTheDocument();
    expect(screen.getByTestId('home-stream-cancel-sid')).toBeInTheDocument();
    expect(screen.getByTestId('home-stream-confirm-sid')).toBeInTheDocument();
    // Restore
    mockStreamData.activeStreamEditorKey = null;
  });

  it('shows stream editor error when streamEditorError is set', () => {
    mockStreamData.activeStreamEditorKey = 'sid' as any;
    mockStreamData.streamEditorError = 'Invalid port';
    render(<StreamStatus isConnected={true} />);
    expect(screen.getByTestId('home-stream-error-sid')).toHaveTextContent('Invalid port');
    // Restore
    mockStreamData.activeStreamEditorKey = null;
    mockStreamData.streamEditorError = null;
  });

  it('calls handleStreamCommit when OK is clicked in editor', () => {
    mockStreamData.activeStreamEditorKey = 'iec' as any;
    render(<StreamStatus isConnected={true} />);
    fireEvent.click(screen.getByTestId('home-stream-confirm-iec'));
    expect(handleStreamCommitSpy).toHaveBeenCalledWith('iec');
    mockStreamData.activeStreamEditorKey = null;
  });
});
