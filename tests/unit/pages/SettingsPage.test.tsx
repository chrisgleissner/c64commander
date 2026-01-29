import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/pages/SettingsPage';
import { reportUserError } from '@/lib/uiErrors';
import { FolderPicker } from '@/lib/native/folderPicker';

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    status: { state: 'OFFLINE_NO_DEMO', isConnected: false, isConnecting: false, error: null, deviceInfo: null },
    baseUrl: 'http://c64u',
    runtimeBaseUrl: 'http://c64u',
    password: '',
    deviceHost: 'c64u',
    updateConfig: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useConnectionState', () => ({
  useConnectionState: () => ({
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
  }),
}));

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/useDeveloperMode', () => ({
  useDeveloperMode: () => ({
    isDeveloperModeEnabled: false,
    enableDeveloperMode: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: () => ({
    value: false,
    setValue: vi.fn(),
  }),
}));

vi.mock('@/hooks/useListPreviewLimit', () => ({
  useListPreviewLimit: () => ({
    limit: 50,
    setLimit: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  clearLogs: vi.fn(),
  formatLogsForShare: vi.fn(() => 'payload'),
  getErrorLogs: vi.fn(() => []),
  getLogs: vi.fn(() => []),
}));

vi.mock('@/lib/native/platform', () => ({
  getPlatform: () => 'android',
}));

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    getPersistedUris: vi.fn(),
    listChildren: vi.fn(),
  },
}));

vi.mock('@/lib/native/safUtils', () => ({
  redactTreeUri: (value: string) => value,
}));

vi.mock('@/lib/config/appSettings', () => ({
  clampConfigWriteIntervalMs: (value: number) => value,
  loadConfigWriteIntervalMs: vi.fn(() => 500),
  clampBackgroundRediscoveryIntervalMs: (value: number) => value,
  clampStartupDiscoveryWindowMs: (value: number) => value,
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadBackgroundRediscoveryIntervalMs: vi.fn(() => 5000),
  loadStartupDiscoveryWindowMs: vi.fn(() => 3000),
  loadDebugLoggingEnabled: vi.fn(() => true),
  loadDiskAutostartMode: vi.fn(() => 'ask'),
  saveAutomaticDemoModeEnabled: vi.fn(),
  saveBackgroundRediscoveryIntervalMs: vi.fn(),
  saveStartupDiscoveryWindowMs: vi.fn(),
  saveConfigWriteIntervalMs: vi.fn(),
  saveDebugLoggingEnabled: vi.fn(),
  saveDiskAutostartMode: vi.fn(),
}));

describe('SettingsPage', () => {
  it('reports share failures to the user', async () => {
    Object.assign(navigator, {
      share: undefined,
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Clipboard blocked')),
      },
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^share$/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'LOG_SHARE',
      }));
    });
  });

  it('reports missing SAF permissions before enumeration', async () => {
    vi.mocked(FolderPicker.getPersistedUris).mockResolvedValue({
      uris: [{ uri: '' }],
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /list persisted uris/i }));

    await waitFor(() => {
      expect(FolderPicker.getPersistedUris).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /enumerate first root/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'SAF_DIAGNOSTICS',
      }));
    });
  });
});
