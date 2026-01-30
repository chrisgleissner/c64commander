import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../../../src/pages/HomePage';

let sidSocketsPayload: Record<string, unknown> | undefined;
let sidAddressingPayload: Record<string, unknown> | undefined;

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: {
      isConnected: true,
      isConnecting: false,
      deviceInfo: null,
    },
  }),
  useC64Drives: () => ({
    data: { drives: [] },
  }),
  useC64ConfigItems: (category: string) => {
    if (category === 'SID Sockets Configuration') {
      return { data: sidSocketsPayload };
    }
    if (category === 'SID Addressing') {
      return { data: sidAddressingPayload };
    }
    return { data: null };
  },
  useC64MachineControl: () => ({
    reset: { mutateAsync: vi.fn(), isPending: false },
    reboot: { mutateAsync: vi.fn(), isPending: false },
    pause: { mutateAsync: vi.fn(), isPending: false },
    resume: { mutateAsync: vi.fn(), isPending: false },
    powerOff: { mutateAsync: vi.fn(), isPending: false },
    menuButton: { mutateAsync: vi.fn(), isPending: false },
    saveConfig: { mutateAsync: vi.fn(), isPending: false },
    loadConfig: { mutateAsync: vi.fn(), isPending: false },
    resetConfig: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/hooks/useAppConfigState', () => ({
  useAppConfigState: () => ({
    appConfigs: [],
    hasChanges: false,
    isApplying: false,
    isSaving: false,
    revertToInitial: vi.fn(),
    saveCurrentConfig: vi.fn(),
    loadAppConfig: vi.fn(),
    renameAppConfig: vi.fn(),
    deleteAppConfig: vi.fn(),
  }),
}));

describe('HomePage SID status', () => {
  it('renders SID layout and updates on config changes', () => {
    (globalThis as any).__APP_VERSION__ = 'test';
    (globalThis as any).__GIT_SHA__ = 'deadbeef';
    (globalThis as any).__BUILD_TIME__ = new Date().toISOString();
    sidSocketsPayload = {
      'SID Sockets Configuration': {
        items: {
          'SID Socket 1': { selected: 'Enabled' },
          'SID Socket 2': { selected: 'Disabled' },
        },
      },
    };
    sidAddressingPayload = {
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

    sidSocketsPayload = {
      'SID Sockets Configuration': {
        items: {
          'SID Socket 1': { selected: 'Disabled' },
          'SID Socket 2': { selected: 'Enabled' },
        },
      },
    };
    sidAddressingPayload = {
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
});
