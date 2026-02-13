/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import HomePage from '../../../src/pages/HomePage';

const {
  toastSpy,
  reportUserErrorSpy,
  c64ApiMockRef,
  queryClientMockRef,
  sidSocketsPayloadRef,
  sidAddressingPayloadRef,
  audioMixerPayloadRef,
  streamPayloadRef,
  driveASettingsPayloadRef,
  driveBSettingsPayloadRef,
  statusPayloadRef,
  drivesPayloadRef,
  machineControlPayloadRef,
  appConfigStatePayloadRef,
} = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  reportUserErrorSpy: vi.fn(),
  c64ApiMockRef: {
    current: {
      setConfigValue: vi.fn().mockResolvedValue({}),
      resetDrive: vi.fn().mockResolvedValue({}),
      writeMemory: vi.fn().mockResolvedValue({}),
    },
  },
  queryClientMockRef: {
    current: {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      fetchQuery: vi.fn().mockResolvedValue(undefined),
    },
  },
  sidSocketsPayloadRef: { current: undefined as Record<string, unknown> | undefined },
  sidAddressingPayloadRef: { current: undefined as Record<string, unknown> | undefined },
  audioMixerPayloadRef: { current: undefined as Record<string, unknown> | undefined },
  streamPayloadRef: { current: undefined as Record<string, unknown> | undefined },
  driveASettingsPayloadRef: { current: undefined as Record<string, unknown> | undefined },
  driveBSettingsPayloadRef: { current: undefined as Record<string, unknown> | undefined },
  statusPayloadRef: {
    current: {
      isConnected: true,
      isConnecting: false,
      deviceInfo: null as null | {
        product: string;
        hostname: string;
        firmware_version: string;
        fpga_version: string;
        core_version: string;
        unique_id: string;
      },
    },
  },
  drivesPayloadRef: {
    current: {
      drives: [] as Array<Record<string, { enabled?: boolean; image_file?: string; bus_id?: number; type?: string }>>,
    },
  },
  machineControlPayloadRef: {
    current: {
      reset: { mutateAsync: vi.fn(), isPending: false },
      reboot: { mutateAsync: vi.fn(), isPending: false },
      pause: { mutateAsync: vi.fn(), isPending: false },
      resume: { mutateAsync: vi.fn(), isPending: false },
      powerOff: { mutateAsync: vi.fn(), isPending: false },
      menuButton: { mutateAsync: vi.fn(), isPending: false },
      saveConfig: { mutateAsync: vi.fn(), isPending: false },
      loadConfig: { mutateAsync: vi.fn(), isPending: false },
      resetConfig: { mutateAsync: vi.fn(), isPending: false },
    },
  },
  appConfigStatePayloadRef: {
    current: {
      appConfigs: [] as Array<{ id: string; name: string; savedAt: string }>,
      hasChanges: false,
      isApplying: false,
      isSaving: false,
      revertToInitial: vi.fn(),
      saveCurrentConfig: vi.fn(),
      loadAppConfig: vi.fn(),
      renameAppConfig: vi.fn(),
      deleteAppConfig: vi.fn(),
    },
  },
}));

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/components/DiagnosticsActivityIndicator', () => ({
  DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} data-testid="diagnostics-activity-indicator" />
  ),
}));

const buildRouter = (ui: JSX.Element) => createMemoryRouter(
  [{ path: '*', element: ui }],
  {
    initialEntries: ['/'],
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  },
);

const renderWithRouter = (ui: JSX.Element) => render(
  <RouterProvider
    router={buildRouter(ui)}
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  />,
);

const renderHomePage = () => renderWithRouter(<HomePage />);

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClientMockRef.current,
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: statusPayloadRef.current,
  }),
  useC64Drives: () => ({
    data: drivesPayloadRef.current,
    refetch: vi.fn().mockImplementation(() => queryClientMockRef.current.fetchQuery()),
  }),
  useC64ConfigItem: () => ({ data: undefined, isLoading: false }),
  useC64ConfigItems: (category: string) => {
    if (category === 'SID Sockets Configuration') {
      return { data: sidSocketsPayloadRef.current };
    }
    if (category === 'SID Addressing') {
      return { data: sidAddressingPayloadRef.current };
    }
    if (category === 'Audio Mixer') {
      return { data: audioMixerPayloadRef.current };
    }
    if (category === 'Data Streams') {
      return { data: streamPayloadRef.current };
    }
    if (category === 'Drive A Settings') {
      return { data: driveASettingsPayloadRef.current };
    }
    if (category === 'Drive B Settings') {
      return { data: driveBSettingsPayloadRef.current };
    }
    return { data: null };
  },
  useC64MachineControl: () => machineControlPayloadRef.current,
}));

vi.mock('@/hooks/useAppConfigState', () => ({
  useAppConfigState: () => appConfigStatePayloadRef.current,
}));

vi.mock('@/hooks/useActionTrace', () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      // Filter out framer-motion props to avoid React warnings in tests and ensure clean DOM
      const { initial, animate, exit, transition, variants, ...validProps } = props;
      return <div {...validProps}>{children}</div>;
    },
    button: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, ...validProps } = props;
      return <button {...validProps}>{children}</button>;
    },
    span: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, ...validProps } = props;
      return <span {...validProps}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/hooks/useDiagnosticsActivity', () => ({
  useDiagnosticsActivity: () => ({ restInFlight: 0, setRestInFlight: vi.fn() }),
}));

vi.mock('@/lib/diagnostics/diagnosticsOverlayState', () => ({
  isDiagnosticsOverlayActive: () => false,
  subscribeDiagnosticsOverlay: () => () => { },
  shouldSuppressDiagnosticsSideEffects: () => false,
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: reportUserErrorSpy,
}));

vi.mock('@/lib/c64api', () => ({
  getC64API: () => c64ApiMockRef.current,
}));

beforeEach(() => {
  toastSpy.mockReset();
  reportUserErrorSpy.mockReset();
  queryClientMockRef.current = {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  };
  sidSocketsPayloadRef.current = undefined;
  sidAddressingPayloadRef.current = undefined;
  audioMixerPayloadRef.current = undefined;
  streamPayloadRef.current = undefined;
  driveASettingsPayloadRef.current = undefined;
  driveBSettingsPayloadRef.current = undefined;
  c64ApiMockRef.current = {
    setConfigValue: vi.fn().mockResolvedValue({}),
    resetDrive: vi.fn().mockResolvedValue({}),
    writeMemory: vi.fn().mockResolvedValue({}),
    startStream: vi.fn().mockResolvedValue({}),
    stopStream: vi.fn().mockResolvedValue({}),
  };
  statusPayloadRef.current = {
    isConnected: true,
    isConnecting: false,
    deviceInfo: null,
  };
  drivesPayloadRef.current = { drives: [] };
  machineControlPayloadRef.current = {
    reset: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    reboot: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    pause: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    resume: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    powerOff: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    menuButton: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    saveConfig: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    loadConfig: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    resetConfig: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  };
  appConfigStatePayloadRef.current = {
    appConfigs: [],
    hasChanges: false,
    isApplying: false,
    isSaving: false,
    revertToInitial: vi.fn().mockResolvedValue(undefined),
    saveCurrentConfig: vi.fn().mockResolvedValue(undefined),
    loadAppConfig: vi.fn().mockResolvedValue(undefined),
    renameAppConfig: vi.fn(),
    deleteAppConfig: vi.fn(),
  };
  (globalThis as any).__APP_VERSION__ = 'test';
  (globalThis as any).__GIT_SHA__ = 'deadbeef';
  (globalThis as any).__BUILD_TIME__ = '';
});

describe('HomePage SID status', () => {
  vi.setConfig({ testTimeout: 15000 });

  it('renders the Home subtitle as C64 Commander', () => {
    renderHomePage();
    expect(screen.getByTestId('home-header-subtitle').textContent).toBe('C64 Commander');
  });

  it('renders SID layout and updates on config changes', () => {
    (globalThis as any).__BUILD_TIME__ = new Date().toISOString();
    sidSocketsPayloadRef.current = {
      'SID Sockets Configuration': {
        items: {
          'SID Socket 1': { selected: 'Enabled' },
          'SID Socket 2': { selected: 'Disabled' },
        },
      },
    };
    sidAddressingPayloadRef.current = {
      'SID Addressing': {
        items: {
          'UltiSID 1 Address': { selected: 'Unmapped' },
          'UltiSID 2 Address': { selected: '$D400' },
        },
      },
    };

    const { rerender } = renderHomePage();

    expect(within(screen.getByTestId('home-sid-status')).getAllByText('SID').length).toBeGreaterThan(0);
    const sidSocket1 = screen.getByText('SID Socket 1');
    const sidSocket2 = screen.getByText('SID Socket 2');
    const ultiSid1 = screen.getByText('UltiSID 1');
    const ultiSid2 = screen.getByText('UltiSID 2');
    expect(sidSocket1).toBeTruthy();
    expect(sidSocket2).toBeTruthy();
    expect(ultiSid1).toBeTruthy();
    expect(ultiSid2).toBeTruthy();

    expect(screen.getByTestId('home-sid-toggle-socket1').textContent).toBe('ON');
    expect(screen.getByTestId('home-sid-toggle-socket2').textContent).toBe('OFF');

    sidSocketsPayloadRef.current = {
      'SID Sockets Configuration': {
        items: {
          'SID Socket 1': { selected: 'Disabled' },
          'SID Socket 2': { selected: 'Enabled' },
        },
      },
    };
    sidAddressingPayloadRef.current = {
      'SID Addressing': {
        items: {
          'UltiSID 1 Address': { selected: '$D400' },
          'UltiSID 2 Address': { selected: 'Unmapped' },
        },
      },
    };

    rerender(
      <RouterProvider
        router={buildRouter(<HomePage />)}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />,
    );

    expect(screen.getByTestId('home-sid-toggle-socket1').textContent).toBe('OFF');
    expect(screen.getByTestId('home-sid-toggle-socket2').textContent).toBe('ON');
    expect(screen.getByTestId('home-sid-toggle-ultiSid1').textContent).toBe('ON');
    expect(screen.getByTestId('home-sid-toggle-ultiSid2').textContent).toBe('OFF');
  });

  it('renders stream rows with full IP:PORT endpoint values from Data Streams config', () => {
    streamPayloadRef.current = {
      'Data Streams': {
        items: {
          'Stream VIC to': { selected: '239.0.1.64:11000' },
          'Stream Audio to': { selected: 'off' },
          'Stream Debug to': { selected: '239.0.1.66' },
        },
      },
    };

    renderHomePage();

    const streamSection = screen.getByTestId('home-stream-status');
    expect(within(streamSection).getByText('Streams')).toBeTruthy();
    expect(within(streamSection).getAllByTestId(/^home-stream-row-/)).toHaveLength(3);
    expect(within(streamSection).getByText('VIC')).toBeTruthy();
    expect(within(streamSection).getByText('AUDIO')).toBeTruthy();
    expect(within(streamSection).getByText('DEBUG')).toBeTruthy();
    expect(within(streamSection).getAllByText('Start').length).toBe(3);
    expect(within(streamSection).getAllByText('Stop').length).toBe(3);
    expect(within(streamSection).queryByTestId('home-stream-endpoint-vic')).toBeNull();
    expect(within(streamSection).getByTestId('home-stream-endpoint-display-vic').textContent).toBe('239.0.1.64:11000');
    expect(within(streamSection).getByTestId('home-stream-endpoint-display-debug').textContent).toBe('239.0.1.66:11002');
  });

  it('resets all connected drives from Home drives section', async () => {
    drivesPayloadRef.current = {
      drives: [
        { a: { enabled: true, image_file: 'disk-a.d64' } },
        { b: { enabled: true } },
        { 'IEC Drive': { enabled: true, bus_id: 11, type: 'DOS emulation' } },
      ],
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId('home-drives-reset'));

    await waitFor(() => expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledTimes(3));
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith('a');
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith('b');
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith('softiec');
    expect(queryClientMockRef.current.fetchQuery).toHaveBeenCalled();
  });

  it('resets printer only from Home printer section', async () => {
    drivesPayloadRef.current = {
      drives: [
        { a: { enabled: true, image_file: 'disk-a.d64' } },
        { b: { enabled: true } },
        { 'IEC Drive': { enabled: true, bus_id: 11, type: 'DOS emulation' } },
        { 'Printer Emulation': { enabled: true, bus_id: 4 } },
      ],
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId('home-printer-reset'));

    await waitFor(() => expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledTimes(1));
    expect(c64ApiMockRef.current.resetDrive).toHaveBeenCalledWith('printer');
    expect(queryClientMockRef.current.fetchQuery).toHaveBeenCalled();
  });

  it('writes SID silence registers when SID reset is pressed', async () => {
    sidAddressingPayloadRef.current = {
      'SID Addressing': {
        items: {
          'SID Socket 1 Address': { selected: '$D400' },
          'SID Socket 2 Address': { selected: 'Unmapped' },
          'UltiSID 1 Address': { selected: '$D420' },
          'UltiSID 2 Address': { selected: 'Unmapped' },
        },
      },
    };

    renderHomePage();

    const sidSection = screen.getByTestId('home-sid-status');
    fireEvent.click(screen.getByTestId('home-sid-reset'));

    await waitFor(() => expect(c64ApiMockRef.current.writeMemory).toHaveBeenCalledTimes(20));
    expect(c64ApiMockRef.current.writeMemory).toHaveBeenCalledWith('D404', new Uint8Array([0]));
    expect(c64ApiMockRef.current.writeMemory).toHaveBeenCalledWith('D424', new Uint8Array([0]));
  });

  it('rejects invalid stream host input safely', async () => {
    streamPayloadRef.current = {
      'Data Streams': {
        items: {
          'Stream VIC to': { selected: '239.0.1.64:11000' },
          'Stream Audio to': { selected: 'off' },
          'Stream Debug to': { selected: '239.0.1.66:11002' },
        },
      },
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId('home-stream-edit-toggle-vic'));
    const endpointInput = screen.getByTestId('home-stream-endpoint-vic');
    fireEvent.change(endpointInput, { target: { value: 'bad host!:11000' } });
    fireEvent.click(screen.getByTestId('home-stream-confirm-vic'));

    await waitFor(() => expect(reportUserErrorSpy).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'STREAM_VALIDATE',
    })));
    expect(screen.getByTestId('home-stream-error-vic').textContent).toContain('Enter a valid IPv4 address');
    expect(c64ApiMockRef.current.setConfigValue).not.toHaveBeenCalled();
  });

  it('supports inline stream edit with explicit confirm', async () => {
    streamPayloadRef.current = {
      'Data Streams': {
        items: {
          'Stream VIC to': { selected: '239.0.1.64:11000' },
          'Stream Audio to': { selected: '239.0.1.65:11001' },
          'Stream Debug to': { selected: 'off' },
        },
      },
    };

    renderHomePage();

    fireEvent.click(screen.getByTestId('home-stream-edit-toggle-vic'));
    fireEvent.change(screen.getByTestId('home-stream-endpoint-vic'), { target: { value: '239.0.1.90:12000' } });
    fireEvent.click(screen.getByTestId('home-stream-confirm-vic'));

    await waitFor(() => expect(c64ApiMockRef.current.setConfigValue).toHaveBeenCalledWith(
      'Data Streams',
      'Stream VIC to',
      '239.0.1.90:12000',
    ));
    expect(screen.queryByTestId('home-stream-endpoint-vic')).toBeNull();
  });

  it('renders two-line drives rows with explicit labels and supports dropdown interaction', async () => {
    drivesPayloadRef.current = {
      drives: [
        { a: { enabled: true, bus_id: 8, type: '1541' } },
        { b: { enabled: true, bus_id: 9, type: '1571' } },
        { 'IEC Drive': { enabled: false, bus_id: 11, type: 'DOS emulation' } },
      ],
    };
    driveASettingsPayloadRef.current = {
      'Drive A Settings': {
        items: {
          Drive: { selected: 'Enabled' },
          'Drive Bus ID': { selected: '8', options: ['8', '9', '10', '11'] },
          'Drive Type': { selected: '1541', options: ['1541', '1571', '1581'] },
        },
      },
    };
    driveBSettingsPayloadRef.current = {
      'Drive B Settings': {
        items: {
          Drive: { selected: 'Enabled' },
          'Drive Bus ID': { selected: '9', options: ['8', '9', '10', '11'] },
          'Drive Type': { selected: '1571', options: ['1541', '1571', '1581'] },
        },
      },
    };

    renderHomePage();

    const drivesGroup = screen.getByTestId('home-drives-group');
    expect(within(drivesGroup).getByTestId('home-drive-row-a')).toBeTruthy();
    expect(within(drivesGroup).getByTestId('home-drive-row-b')).toBeTruthy();
    expect(within(drivesGroup).getByTestId('home-drive-row-soft-iec')).toBeTruthy();
    expect(within(drivesGroup).getByText('Drive A')).toBeTruthy();
    expect(within(drivesGroup).getByText('Drive B')).toBeTruthy();
    expect(within(drivesGroup).getByText('Soft IEC Drive')).toBeTruthy();
    expect(within(drivesGroup).getAllByText('Bus ID').length).toBeGreaterThanOrEqual(3);
    expect(within(drivesGroup).getAllByText('Type').length).toBeGreaterThanOrEqual(2);
    expect(within(drivesGroup).getByText('Path')).toBeTruthy();

    const driveBusSelect = screen.getByTestId('home-drive-bus-a');
    fireEvent.click(driveBusSelect);
    await waitFor(() => expect(document.body.getAttribute('data-scroll-locked')).toBe('1'));
    fireEvent.keyDown(document.activeElement ?? driveBusSelect, { key: 'Escape' });

    const driveTypeSelect = screen.getByTestId('home-drive-type-a');
    fireEvent.click(driveTypeSelect);
    await waitFor(() => expect(document.body.getAttribute('data-scroll-locked')).toBe('1'));
    fireEvent.keyDown(document.activeElement ?? driveTypeSelect, { key: 'Escape' });
  });

  it('shows concise drive DOS status on Home and opens full details overlay on click', () => {
    drivesPayloadRef.current = {
      drives: [
        { a: { enabled: true, bus_id: 8, type: '1541', last_error: '74,DRIVE NOT READY,00,00' } },
        { b: { enabled: true, bus_id: 9, type: '1541' } },
        { 'IEC Drive': { enabled: true, bus_id: 11, type: 'DOS emulation', last_error: '73,U64IEC ULTIMATE DOS V1.1,00,00' } },
      ],
    };

    renderHomePage();

    expect(screen.getByTestId('home-drive-status-a')).toHaveTextContent('DRIVE NOT READY');
    expect(screen.getByTestId('home-drive-status-soft-iec')).toHaveTextContent('DOS MISMATCH');

    fireEvent.click(screen.getByTestId('home-drive-status-a'));
    expect(screen.getByText('Drive A: DRIVE NOT READY')).toBeInTheDocument();
    expect(screen.getByTestId('home-drive-status-details-text')).toHaveTextContent(/cannot access media/i);
    expect(screen.getByTestId('home-drive-status-details-raw')).toHaveTextContent('74,DRIVE NOT READY,00,00');
  });

  it('shows explicit disconnected build info values and offline message', () => {
    (globalThis as any).__APP_VERSION__ = '';
    (globalThis as any).__GIT_SHA__ = '';
    (globalThis as any).__BUILD_TIME__ = '';
    statusPayloadRef.current = {
      isConnected: false,
      isConnecting: false,
      deviceInfo: null,
    };

    renderHomePage();

    const systemInfo = screen.getByTestId('home-system-info');
    fireEvent.click(systemInfo);

    expect(screen.getByTestId('home-system-version').textContent).toContain('—');
    expect(screen.getByTestId('home-system-device').textContent).toContain('Not connected');
    expect(screen.getByTestId('home-system-firmware').textContent).toContain('Not connected');
    expect(screen.getByTestId('home-system-git').textContent).toContain('Not available');
    expect(screen.getByTestId('home-system-build-time').textContent).toContain('2026-01-01 12:00:00 UTC');
    expect(screen.getByText(/unable to connect to c64u/i)).toBeTruthy();
  });

  it('renders device info and drive summaries', () => {
    statusPayloadRef.current = {
      isConnected: true,
      isConnecting: false,
      deviceInfo: {
        product: 'C64U',
        hostname: 'c64u.local',
        firmware_version: '1.0.0',
        fpga_version: '2.0.0',
        core_version: '3.0.0',
        unique_id: 'abc123',
      },
    };
    drivesPayloadRef.current = {
      drives: [{ a: { enabled: true, image_file: 'disk.d64' }, b: { enabled: false } }],
    };
    (globalThis as any).__APP_VERSION__ = '1.2.3';
    (globalThis as any).__GIT_SHA__ = 'deadbeefcafefeed';
    (globalThis as any).__BUILD_TIME__ = '2024-03-20T12:34:00.000Z';

    renderHomePage();

    const systemInfo = screen.getByTestId('home-system-info');
    fireEvent.click(systemInfo);

    expect(screen.getByTestId('home-system-version').textContent).toContain('1.2.3');
    expect(screen.getByTestId('home-system-device').textContent).toContain('c64u.local');
    expect(screen.getByTestId('home-system-firmware').textContent).toContain('1.0.0');
    expect(screen.getByTestId('home-system-git').textContent).toContain('deadbeef');
    expect(screen.getByTestId('home-system-build-time').textContent).toContain('2024-03-20 12:34:00 UTC');
    expect(screen.getByTestId('home-drive-summary').textContent).toContain('disk.d64');
  });

  it('shows "No disk" on Home when drive A has no mounted image', () => {
    statusPayloadRef.current = {
      isConnected: true,
      isConnecting: false,
      deviceInfo: null,
    };
    drivesPayloadRef.current = {
      drives: [{ a: { enabled: true }, b: { enabled: true } }],
    };

    renderHomePage();

    expect(screen.getAllByText('No disk mounted').length).toBeGreaterThan(0);
  });

  it('handles machine actions and reports errors', async () => {
    const menuError = new Error('menu failed');
    machineControlPayloadRef.current.menuButton.mutateAsync = vi.fn().mockRejectedValue(menuError);

    renderHomePage();

    fireEvent.click(screen.getAllByRole('button', { name: /^Reset$/ })[0]);
    await waitFor(() => expect(machineControlPayloadRef.current.reset.mutateAsync).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Machine reset' });

    fireEvent.click(screen.getByRole('button', { name: /^Menu$/ }));
    await waitFor(() => expect(reportUserErrorSpy).toHaveBeenCalled());
    expect(reportUserErrorSpy.mock.calls[0][0]).toMatchObject({
      operation: 'HOME_ACTION',
      title: 'Error',
      context: { action: 'Menu toggled' },
    });
  });

  it('requires explicit confirmation before power off', async () => {
    renderHomePage();

    fireEvent.click(screen.getByRole('button', { name: /^power off$/i }));
    expect(machineControlPayloadRef.current.powerOff.mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cannot be powered on again via software/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    expect(machineControlPayloadRef.current.powerOff.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^power off$/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^power off$/i }));
    await waitFor(() => expect(machineControlPayloadRef.current.powerOff.mutateAsync).toHaveBeenCalled());
  });

  it('renders exactly eight machine controls with one pause-resume control', async () => {
    renderHomePage();

    const machineControls = screen.getByTestId('home-machine-controls');
    expect(within(machineControls).getAllByRole('button')).toHaveLength(8);
    expect(within(machineControls).getAllByRole('button', { name: /^pause$/i })).toHaveLength(1);
    expect(within(machineControls).queryByRole('button', { name: /^resume$/i })).toBeNull();

    fireEvent.click(within(machineControls).getByRole('button', { name: /^pause$/i }));

    await waitFor(() => expect(machineControlPayloadRef.current.pause.mutateAsync).toHaveBeenCalledTimes(1));
    expect(within(machineControls).queryByRole('button', { name: /^pause$/i })).toBeNull();
    expect(within(machineControls).getAllByRole('button', { name: /^resume$/i })).toHaveLength(1);

    fireEvent.click(within(machineControls).getByRole('button', { name: /^resume$/i }));
    await waitFor(() => expect(machineControlPayloadRef.current.resume.mutateAsync).toHaveBeenCalledTimes(1));
    expect(within(machineControls).getAllByRole('button', { name: /^pause$/i })).toHaveLength(1);
  });

  it('manages app configs via dialogs', async () => {
    const savedAt = new Date('2024-01-01T00:00:00.000Z').toISOString();
    appConfigStatePayloadRef.current = {
      ...appConfigStatePayloadRef.current,
      appConfigs: [
        { id: 'config-a', name: 'Config A', savedAt },
        { id: 'config-b', name: 'Config B', savedAt },
      ],
      hasChanges: true,
    };

    renderHomePage();

    fireEvent.click(screen.getByRole('button', { name: /revert changes/i }));
    await waitFor(() => expect(appConfigStatePayloadRef.current.revertToInitial).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Config reverted' });

    fireEvent.click(screen.getByRole('button', { name: /save to app/i }));
    const saveDialog = screen.getByRole('dialog');
    fireEvent.click(within(saveDialog).getByRole('button', { name: /^save$/i }));
    expect(toastSpy).toHaveBeenCalledWith({
      title: 'Name required',
      description: 'Enter a config name first.',
    });

    fireEvent.change(within(saveDialog).getByPlaceholderText(/config name/i), { target: { value: 'Config A' } });
    fireEvent.click(within(saveDialog).getByRole('button', { name: /^save$/i }));
    expect(toastSpy).toHaveBeenCalledWith({
      title: 'Name already used',
      description: 'Choose a unique config name.',
    });

    fireEvent.change(within(saveDialog).getByPlaceholderText(/config name/i), { target: { value: 'Config C' } });
    fireEvent.click(within(saveDialog).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(appConfigStatePayloadRef.current.saveCurrentConfig).toHaveBeenCalledWith('Config C'));
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Saved to app', description: 'Config C' });

    fireEvent.click(screen.getByRole('button', { name: /load from app/i }));
    const loadDialog = screen.getByRole('dialog');
    fireEvent.click(within(loadDialog).getByRole('button', { name: /config a/i }));
    await waitFor(() => expect(appConfigStatePayloadRef.current.loadAppConfig).toHaveBeenCalled());
    expect(appConfigStatePayloadRef.current.loadAppConfig).toHaveBeenCalledWith({
      id: 'config-a',
      name: 'Config A',
      savedAt,
    });

    fireEvent.click(screen.getByRole('button', { name: /manage app configs/i }));
    const manageDialog = screen.getByRole('dialog');
    fireEvent.change(within(manageDialog).getByDisplayValue('Config A'), { target: { value: '  New Name  ' } });
    const [renameButton] = within(manageDialog).getAllByRole('button', { name: /rename/i });
    fireEvent.click(renameButton);
    expect(appConfigStatePayloadRef.current.renameAppConfig).toHaveBeenCalledWith('config-a', 'New Name');
    const [deleteButton] = within(manageDialog).getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButton);
    expect(appConfigStatePayloadRef.current.deleteAppConfig).toHaveBeenCalledWith('config-a');
  }, 10000);
});
