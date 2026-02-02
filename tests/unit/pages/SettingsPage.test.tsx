import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/pages/SettingsPage';
import { reportUserError } from '@/lib/uiErrors';
import { FolderPicker } from '@/lib/native/folderPicker';
import { discoverConnection } from '@/lib/connection/connectionManager';
import { toast } from '@/hooks/use-toast';
import { clearLogs, getErrorLogs, getLogs } from '@/lib/logging';
import { clearTraceEvents, getTraceEvents } from '@/lib/tracing/traceSession';
import { shareTraceZip } from '@/lib/tracing/traceExport';
import {
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDebugLoggingEnabled,
  saveStartupDiscoveryWindowMs,
} from '@/lib/config/appSettings';
import * as deviceSafetySettings from '@/lib/config/deviceSafetySettings';
import { exportSettingsJson, importSettingsJson } from '@/lib/config/settingsTransfer';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
    li: ({ children, ...props }: any) => <li {...props}>{children}</li>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const {
  mockUpdateConfig,
  mockRefetch,
  mockEnableDeveloperMode,
  mockSetFeatureFlag,
  mockSetTheme,
  mockSetListPreviewLimit,
  connectionPayloadRef,
  connectionStateRef,
} = vi.hoisted(() => ({
  mockUpdateConfig: vi.fn(),
  mockRefetch: vi.fn(),
  mockEnableDeveloperMode: vi.fn(),
  mockSetFeatureFlag: vi.fn(),
  mockSetTheme: vi.fn(),
  mockSetListPreviewLimit: vi.fn(),
  connectionPayloadRef: {
    current: {
      status: { state: 'OFFLINE_NO_DEMO', isConnected: false, isConnecting: false, error: null, deviceInfo: null },
      baseUrl: 'http://c64u',
      runtimeBaseUrl: 'http://c64u',
      password: '',
      deviceHost: 'c64u',
    },
  },
  connectionStateRef: {
    current: {
      lastProbeSucceededAtMs: null as number | null,
      lastProbeFailedAtMs: null as number | null,
    },
  },
}));

vi.mock('@/hooks/useC64Connection', () => ({
  useC64Connection: () => ({
    ...connectionPayloadRef.current,
    updateConfig: mockUpdateConfig,
    refetch: mockRefetch,
  }),
}));

vi.mock('@/hooks/useConnectionState', () => ({
  useConnectionState: () => connectionStateRef.current,
}));

vi.mock('@/components/ThemeProvider', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: mockSetTheme,
  }),
}));

vi.mock('@/hooks/useDeveloperMode', () => ({
  useDeveloperMode: () => ({
    isDeveloperModeEnabled: false,
    enableDeveloperMode: mockEnableDeveloperMode,
  }),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: () => ({
    value: false,
    setValue: mockSetFeatureFlag,
  }),
}));

vi.mock('@/hooks/useListPreviewLimit', () => ({
  useListPreviewLimit: () => ({
    limit: 50,
    setLimit: mockSetListPreviewLimit,
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
  isNativePlatform: () => true,
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

vi.mock('@/lib/connection/connectionManager', () => ({
  discoverConnection: vi.fn(),
  dismissDemoInterstitial: vi.fn(),
}));

vi.mock('@/lib/tracing/traceSession', () => ({
  clearTraceEvents: vi.fn(),
  getTraceEvents: vi.fn(() => []),
  recordActionStart: vi.fn(),
  recordActionEnd: vi.fn(),
  recordActionScopeStart: vi.fn(),
  recordActionScopeEnd: vi.fn(),
  recordTraceError: vi.fn(),
}));

vi.mock('@/hooks/useActionTrace', () => ({
  useActionTrace: () => Object.assign(<T extends (...args: any[]) => any>(fn: T) => fn, { scope: async () => undefined }),
}));

vi.mock('@/lib/tracing/traceExport', () => ({
  shareTraceZip: vi.fn(),
}));

vi.mock('@/lib/config/settingsTransfer', () => ({
  exportSettingsJson: vi.fn(() => '{"version":1}'),
  importSettingsJson: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/config/appSettings', () => ({
  clampConfigWriteIntervalMs: (value: number) => value,
  clampDiscoveryProbeTimeoutMs: (value: number) => value,
  loadConfigWriteIntervalMs: vi.fn(() => 500),
  clampBackgroundRediscoveryIntervalMs: (value: number) => value,
  clampStartupDiscoveryWindowMs: (value: number) => value,
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadBackgroundRediscoveryIntervalMs: vi.fn(() => 5000),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 3000),
  loadDebugLoggingEnabled: vi.fn(() => true),
  loadDiskAutostartMode: vi.fn(() => 'kernal'),
  saveAutomaticDemoModeEnabled: vi.fn(),
  saveBackgroundRediscoveryIntervalMs: vi.fn(),
  saveDiscoveryProbeTimeoutMs: vi.fn(),
  saveStartupDiscoveryWindowMs: vi.fn(),
  saveConfigWriteIntervalMs: vi.fn(),
  saveDebugLoggingEnabled: vi.fn(),
  saveDiskAutostartMode: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  connectionPayloadRef.current = {
    status: { state: 'OFFLINE_NO_DEMO', isConnected: false, isConnecting: false, error: null, deviceInfo: null },
    baseUrl: 'http://c64u',
    runtimeBaseUrl: 'http://c64u',
    password: '',
    deviceHost: 'c64u',
  };
  connectionStateRef.current = {
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
  };
  vi.mocked(getLogs).mockReturnValue([]);
  vi.mocked(getErrorLogs).mockReturnValue([]);
  vi.mocked(getTraceEvents).mockReturnValue([]);
  vi.mocked(shareTraceZip).mockReset();
});

describe('SettingsPage', () => {
  const buildFileList = (file: File) => {
    if (typeof DataTransfer !== 'undefined') {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      return transfer.files;
    }
    return {
      0: file,
      length: 1,
      item: () => file,
    } as FileList;
  };
  it('saves connection settings and triggers discovery', async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith('c64u', undefined);
      expect(discoverConnection).toHaveBeenCalledWith('settings');
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connection settings saved' }));
    });
  });

  it('orders core sections and places network timing under Device Safety', () => {
    render(<SettingsPage />);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent ?? '');
    const appearanceIndex = headings.indexOf('Appearance');
    const connectionIndex = headings.indexOf('Connection');
    const diagnosticsIndex = headings.indexOf('Diagnostics');
    const deviceSafetyIndex = headings.indexOf('Device Safety');

    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(connectionIndex).toBeGreaterThan(appearanceIndex);
    expect(diagnosticsIndex).toBeGreaterThan(connectionIndex);
    expect(deviceSafetyIndex).toBeGreaterThan(diagnosticsIndex);
    expect(deviceSafetyIndex).toBe(headings.length - 1);

    const connectionSection = screen.getByRole('heading', { name: 'Connection' }).closest('.bg-card');
    const deviceSafetySection = screen.getByRole('heading', { name: 'Device Safety' }).closest('.bg-card');

    expect(connectionSection).toBeTruthy();
    expect(deviceSafetySection).toBeTruthy();

    if (connectionSection) {
      expect(within(connectionSection).queryByText('Startup Discovery Window (seconds)')).toBeNull();
      expect(within(connectionSection).queryByText('Background Rediscovery Interval (seconds)')).toBeNull();
      expect(within(connectionSection).queryByText('Discovery Probe Timeout (seconds)')).toBeNull();
    }

    if (deviceSafetySection) {
      expect(within(deviceSafetySection).getByText('Startup Discovery Window (seconds)')).toBeInTheDocument();
      expect(within(deviceSafetySection).getByText('Background Rediscovery Interval (seconds)')).toBeInTheDocument();
      expect(within(deviceSafetySection).getByText('Discovery Probe Timeout (seconds)')).toBeInTheDocument();
    }
  });

  it('reports connection save errors', async () => {
    vi.mocked(discoverConnection).mockRejectedValue(new Error('Boom'));

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /save & connect/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'CONNECTION_SAVE',
      }));
    });
  });

  it('toggles HVSC download feature flag and persists', () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(<SettingsPage />);

    fireEvent.click(screen.getByTestId('hvsc-toggle'));

    expect(mockSetFeatureFlag).toHaveBeenCalledWith(true);
    expect(localStorageSpy).toHaveBeenCalledWith('c64u_feature_flag:hvsc_enabled', '1');
  });

  it('persists demo mode and debug logging toggles', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /automatic demo mode/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /enable debug logging/i }));

    expect(saveAutomaticDemoModeEnabled).toHaveBeenCalledWith(false);
    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(false);
  });

  it('saves discovery window inputs on blur', () => {
    render(<SettingsPage />);

    const startupInput = screen.getByLabelText(/startup discovery window/i);
    const backgroundInput = screen.getByLabelText(/background rediscovery interval/i);

    fireEvent.change(startupInput, { target: { value: '4' } });
    fireEvent.blur(startupInput);
    fireEvent.change(backgroundInput, { target: { value: '6' } });
    fireEvent.blur(backgroundInput);

    expect(saveStartupDiscoveryWindowMs).toHaveBeenCalledWith(4000);
    expect(saveBackgroundRediscoveryIntervalMs).toHaveBeenCalledWith(6000);
  });

  it('commits list preview limit changes', () => {
    render(<SettingsPage />);

    const input = screen.getByLabelText(/list preview limit/i);
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.blur(input);

    expect(mockSetListPreviewLimit).toHaveBeenCalledWith(75);
  });

  it('changes theme when selecting a new option', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /dark/i }));

    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('shows persisted SAF URIs after refresh', async () => {
    vi.mocked(FolderPicker.getPersistedUris).mockResolvedValue({
      uris: [{ uri: 'content://example' }],
    });
    vi.mocked(FolderPicker.listChildren).mockResolvedValue({
      entries: [{ name: 'Root', path: '/', type: 'dir' }],
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /list persisted uris/i }));

    await waitFor(() => {
      expect(FolderPicker.getPersistedUris).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /enumerate first root/i }));

    await waitFor(() => {
      expect(FolderPicker.listChildren).toHaveBeenCalled();
    });

    expect(screen.getByText(/persisted:/i)).toHaveTextContent('content://example');
    expect(screen.getByText(/dir: \//i)).toBeInTheDocument();
  });

  it('opens share via email', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    fireEvent.click(await screen.findByRole('button', { name: /email errors/i }));

    expect(window.location.href).toMatch(/^mailto:/);

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('enables developer mode after repeated taps', () => {
    render(<SettingsPage />);

    const aboutCard = screen.getByRole('button', { name: /about/i });
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(aboutCard);
    }

    expect(mockEnableDeveloperMode).toHaveBeenCalled();
  });

  it('reports share failures to the user', async () => {
    const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Clipboard blocked')),
      },
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    fireEvent.click(await screen.findByRole('button', { name: /share errors/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'LOG_SHARE',
      }));
    });

    if (originalShare) {
      Object.defineProperty(navigator, 'share', originalShare);
    } else {
      delete (navigator as Navigator & { share?: unknown }).share;
    }

    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as Navigator & { clipboard?: unknown }).clipboard;
    }
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

  it('shows demo probe messaging when demo is active', () => {
    connectionPayloadRef.current = {
      ...connectionPayloadRef.current,
      status: { state: 'DEMO_ACTIVE', isConnected: false, isConnecting: false, error: null, deviceInfo: null },
    };
    connectionStateRef.current = {
      lastProbeSucceededAtMs: Date.now(),
      lastProbeFailedAtMs: null,
    };

    render(<SettingsPage />);

    expect(screen.getByText(/real device detected during probe/i)).toBeInTheDocument();
  });

  it('clears logs and traces from diagnostics dialog', async () => {
    vi.mocked(getErrorLogs).mockReturnValue([
      { id: 'err-1', message: 'Error entry', timestamp: Date.now(), details: { boom: true } },
    ] as any);

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Error entry')).toBeInTheDocument();

    const logsTab = within(dialog).getByRole('tab', { name: /all logs/i });
    fireEvent.mouseDown(logsTab);
    fireEvent.click(logsTab);
    await waitFor(() => expect(logsTab).toHaveAttribute('aria-selected', 'true'));
    vi.mocked(getLogs).mockReturnValue([
      { id: 'log-1', level: 'info', message: 'Log entry', timestamp: Date.now(), details: { ok: true } },
    ] as any);
    await act(async () => {
      window.dispatchEvent(new Event('c64u-logs-updated'));
    });
    expect(await within(dialog).findByText('Log entry')).toBeInTheDocument();

    const tracesTab = within(dialog).getByRole('tab', { name: /traces/i });
    fireEvent.mouseDown(tracesTab);
    fireEvent.click(tracesTab);
    await waitFor(() => expect(tracesTab).toHaveAttribute('aria-selected', 'true'));
    vi.mocked(getTraceEvents).mockReturnValue([
      { id: 'trace-1', type: 'rest', origin: 'user' },
    ] as any);
    await act(async () => {
      window.dispatchEvent(new Event('c64u-traces-updated'));
    });
    expect(await within(dialog).findByText(/rest · user/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /clear traces/i }));
    expect(clearTraceEvents).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'Traces cleared' });

    fireEvent.click(within(dialog).getByRole('button', { name: /clear logs/i }));
    expect(clearLogs).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'Logs cleared' });
  });

  it('exports traces and reports export failures', async () => {
    vi.mocked(shareTraceZip).mockImplementation(() => undefined);

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    const dialog = await screen.findByRole('dialog');
    const tracesTab = within(dialog).getByRole('tab', { name: /traces/i });
    fireEvent.mouseDown(tracesTab);
    fireEvent.click(tracesTab);
    await waitFor(() => expect(tracesTab).toHaveAttribute('aria-selected', 'true'));
    vi.mocked(getTraceEvents).mockReturnValue([
      { id: 'trace-1', type: 'rest', origin: 'user' },
    ] as any);
    await act(async () => {
      window.dispatchEvent(new Event('c64u-traces-updated'));
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: /share\s*\/\s*export/i }));

    expect(shareTraceZip).toHaveBeenCalled();

    vi.mocked(shareTraceZip).mockImplementation(() => {
      throw new Error('export failed');
    });

    fireEvent.click(await within(dialog).findByRole('button', { name: /share\s*\/\s*export/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'TRACE_EXPORT',
      }));
    });
  });

  it('shares diagnostics via clipboard when share is unavailable', async () => {
    const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    fireEvent.click(screen.getByRole('button', { name: /share errors/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('payload');
      expect(toast).toHaveBeenCalledWith({ title: 'Copied errors to clipboard' });
    });

    if (originalShare) {
      Object.defineProperty(navigator, 'share', originalShare);
    } else {
      delete (navigator as Navigator & { share?: unknown }).share;
    }

    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as Navigator & { clipboard?: unknown }).clipboard;
    }
  });

  it('requires confirmation when switching into relaxed safety mode', async () => {
    const saveSpy = vi.spyOn(deviceSafetySettings, 'saveDeviceSafetyMode');

    render(<SettingsPage />);

    const trigger = screen.getAllByRole('combobox')[1];
    fireEvent.change(trigger, { target: { value: 'RELAXED' } });

    const warningDialog = await screen.findByRole('dialog', { name: /enable relaxed safety mode/i });
    expect(warningDialog).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();

    fireEvent.click(within(warningDialog).getByRole('button', { name: /enable relaxed/i }));
    expect(saveSpy).toHaveBeenCalledWith('RELAXED');
  });

  it('exports settings and shows a toast', async () => {
    const createObjectURL = vi.fn(() => 'blob:settings');
    const revokeObjectURL = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        (element as HTMLAnchorElement).click = vi.fn();
      }
      return element;
    });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /export settings/i }));

    expect(exportSettingsJson).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'Settings export ready' });
    createElementSpy.mockRestore();
  });

  it('imports settings and refreshes local state', async () => {
    vi.mocked(importSettingsJson).mockReturnValue({ ok: true });
    const file = new File(['{"version":1}'], 'settings.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: vi.fn(async () => '{"version":1}'),
    });

    render(<SettingsPage />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      expect(importSettingsJson).toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith({ title: 'Settings imported' });
    });
  });

  it('reports import validation errors', async () => {
    vi.mocked(importSettingsJson).mockReturnValue({ ok: false, error: 'Invalid payload' });
    const file = new File(['{"version":1}'], 'settings.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: vi.fn(async () => '{"version":1}'),
    });

    render(<SettingsPage />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'SETTINGS_IMPORT',
      }));
    });
  });

  it('commits FTP overrides on blur and enter', () => {
    render(<SettingsPage />);

    const ftpPortInput = screen.getByLabelText(/ftp port/i);
    fireEvent.change(ftpPortInput, { target: { value: '2121' } });
    fireEvent.blur(ftpPortInput);

    const bridgeInput = screen.getByLabelText(/ftp bridge url/i);
    fireEvent.change(bridgeInput, { target: { value: 'https://bridge.example' } });
    fireEvent.keyDown(bridgeInput, { key: 'Enter' });

    expect(localStorage.getItem('c64u_ftp_port')).toBe('2121');
    expect(localStorage.getItem('c64u_ftp_bridge_url')).toBe('https://bridge.example');
  });

  it('enables debug logging when switching to troubleshooting mode', () => {
    render(<SettingsPage />);

    const trigger = screen.getAllByRole('combobox')[1];
    fireEvent.change(trigger, { target: { value: 'TROUBLESHOOTING' } });

    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
  });
});
