import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../../../src/pages/HomePage';

const {
  mockNavigate,
  toastSpy,
  reportUserErrorSpy,
  sidSocketsPayloadRef,
  sidAddressingPayloadRef,
  statusPayloadRef,
  drivesPayloadRef,
  machineControlPayloadRef,
  appConfigStatePayloadRef,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  toastSpy: vi.fn(),
  reportUserErrorSpy: vi.fn(),
  sidSocketsPayloadRef: { current: undefined as Record<string, unknown> | undefined },
  sidAddressingPayloadRef: { current: undefined as Record<string, unknown> | undefined },
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
      drives: [] as Array<{ a?: { enabled: boolean; image_file?: string }; b?: { enabled: boolean } }>,
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: statusPayloadRef.current,
  }),
  useC64Drives: () => ({
    data: drivesPayloadRef.current,
  }),
  useC64ConfigItems: (category: string) => {
    if (category === 'SID Sockets Configuration') {
      return { data: sidSocketsPayloadRef.current };
    }
    if (category === 'SID Addressing') {
      return { data: sidAddressingPayloadRef.current };
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
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: reportUserErrorSpy,
}));

beforeEach(() => {
  mockNavigate.mockReset();
  toastSpy.mockReset();
  reportUserErrorSpy.mockReset();
  sidSocketsPayloadRef.current = undefined;
  sidAddressingPayloadRef.current = undefined;
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

    const { rerender } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sid-status-label').textContent).toContain('SID');
    const sidSocket1 = screen.getByText('SID Socket 1');
    const sidSocket2 = screen.getByText('SID Socket 2');
    const ultiSid1 = screen.getByText('UltiSID 1');
    const ultiSid2 = screen.getByText('UltiSID 2');
    expect(sidSocket1).toBeTruthy();
    expect(sidSocket2).toBeTruthy();
    expect(ultiSid1).toBeTruthy();
    expect(ultiSid2).toBeTruthy();

    expect(sidSocket1.parentElement?.textContent ?? '').toContain('ON');
    expect(sidSocket2.parentElement?.textContent ?? '').toContain('OFF');

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
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('SID Socket 1').parentElement?.textContent ?? '').toContain('OFF');
    expect(screen.getByText('SID Socket 2').parentElement?.textContent ?? '').toContain('ON');
    expect(screen.getByText('UltiSID 1').parentElement?.textContent ?? '').toContain('ON');
    expect(screen.getByText('UltiSID 2').parentElement?.textContent ?? '').toContain('OFF');
  });

  it('shows build info placeholders and offline message when disconnected', () => {
    (globalThis as any).__APP_VERSION__ = '';
    (globalThis as any).__GIT_SHA__ = '';
    (globalThis as any).__BUILD_TIME__ = '';
    statusPayloadRef.current = {
      isConnected: false,
      isConnecting: false,
      deviceInfo: null,
    };

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Version').nextSibling?.textContent).toContain('—');
    expect(screen.getByText(/Git/i).nextSibling?.textContent).toContain('—');
    expect(screen.getByText(/Build/i).nextSibling?.textContent).toContain('2026-01-01 12:00:00 UTC');
    expect(screen.getByText(/unable to connect to c64 ultimate/i)).toBeTruthy();
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

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getByText('deadbeef')).toBeTruthy();
    expect(screen.getByText('2024-03-20 12:34:00 UTC')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'C64U' })).toBeTruthy();
    expect(screen.getByText('c64u.local')).toBeTruthy();
    expect(screen.getByText('disk.d64')).toBeTruthy();
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

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('No disk')).toBeTruthy();
  });

  it('handles machine actions and reports errors', async () => {
    const menuError = new Error('menu failed');
    machineControlPayloadRef.current.menuButton.mutateAsync = vi.fn().mockRejectedValue(menuError);

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Reset$/ }));
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

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

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
