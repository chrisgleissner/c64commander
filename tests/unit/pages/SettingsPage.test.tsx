import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/pages/SettingsPage';
import { reportUserError } from '@/lib/uiErrors';
import { FolderPicker } from '@/lib/native/folderPicker';
import { discoverConnection } from '@/lib/connection/connectionManager';
import { toast } from '@/hooks/use-toast';
import { clearLogs, getErrorLogs, getLogs } from '@/lib/logging';
import { clearTraceEvents, getTraceEvents } from '@/lib/tracing/traceSession';
import { shareDiagnosticsZip } from '@/lib/diagnostics/diagnosticsExport';
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

vi.mock('@/components/DiagnosticsActivityIndicator', () => ({
  DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} data-testid="diagnostics-activity-indicator" />
  ),
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
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
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

const renderSettingsPage = () => render(
  <RouterProvider
    router={buildRouter(<SettingsPage />)}
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  />,
);

vi.mock('@/lib/uiErrors', () => ({
  reportUserError: vi.fn(),
}));

vi.mock('@/lib/diagnostics/diagnosticsExport', () => ({
  shareDiagnosticsZip: vi.fn(),
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

vi.mock('@/lib/tracing/traceExport', () => ({}));

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
  vi.mocked(shareDiagnosticsZip).mockReset();
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

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith('c64u', undefined);
      expect(discoverConnection).toHaveBeenCalledWith('settings');
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connection settings saved' }));
    });
  });

  it('orders core sections and places network timing under Device Safety', () => {
    renderSettingsPage();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent ?? '');
    const appearanceIndex = headings.indexOf('Appearance');
    const connectionIndex = headings.indexOf('Connection');
    const diagnosticsIndex = headings.indexOf('Diagnostics');
    const deviceSafetyIndex = headings.indexOf('Device Safety');
    const aboutIndex = headings.indexOf('About');

    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(connectionIndex).toBeGreaterThan(appearanceIndex);
    expect(diagnosticsIndex).toBeGreaterThan(connectionIndex);
    expect(deviceSafetyIndex).toBeGreaterThan(diagnosticsIndex);
    expect(aboutIndex).toBeGreaterThan(deviceSafetyIndex);
    expect(aboutIndex).toBe(headings.length - 1);

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

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: /save & connect/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'CONNECTION_SAVE',
      }));
    });
  });

  it('toggles HVSC download feature flag and persists', () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');

    renderSettingsPage();

    fireEvent.click(screen.getByTestId('hvsc-toggle'));

    expect(mockSetFeatureFlag).toHaveBeenCalledWith(true);
    expect(localStorageSpy).toHaveBeenCalledWith('c64u_feature_flag:hvsc_enabled', '1');
  });

  it('persists demo mode and debug logging toggles', () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole('checkbox', { name: /automatic demo mode/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /enable debug logging/i }));

    expect(saveAutomaticDemoModeEnabled).toHaveBeenCalledWith(false);
    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(false);
  });

  it('saves discovery window inputs on blur', () => {
    renderSettingsPage();

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
    renderSettingsPage();

    const input = screen.getByLabelText(/list preview limit/i);
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.blur(input);

    expect(mockSetListPreviewLimit).toHaveBeenCalledWith(75);
  });

  it('changes theme when selecting a new option', () => {
    renderSettingsPage();

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

    renderSettingsPage();

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

  it('enables developer mode after repeated taps', () => {
    renderSettingsPage();

    const aboutCard = screen.getByRole('button', { name: /about/i });
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(aboutCard);
    }

    expect(mockEnableDeveloperMode).toHaveBeenCalled();
  });

  it('reports missing SAF permissions before enumeration', async () => {
    vi.mocked(FolderPicker.getPersistedUris).mockResolvedValue({
      uris: [{ uri: '' }],
    });

    renderSettingsPage();

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

    renderSettingsPage();

    expect(screen.getByText(/real device detected during probe/i)).toBeInTheDocument();
  });

  it('shows diagnostics tabs in required order', async () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');
    const tabLabels = within(dialog).getAllByRole('tab').map((tab) => tab.textContent);

    expect(tabLabels).toEqual(['Errors', 'Logs', 'Traces', 'Actions']);
  });

  it('opens diagnostics on Actions tab when requested', async () => {
    renderSettingsPage();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('c64u-diagnostics-open-request', { detail: { tab: 'actions' } }));
    });

    const dialog = await screen.findByRole('dialog');
    const actionsTab = within(dialog).getByRole('tab', { name: /actions/i });
    await waitFor(() => expect(actionsTab).toHaveAttribute('aria-selected', 'true'));
  });

  it('renders a single diagnostics action bar', async () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: /clear all/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /share\s*\/\s*export/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /clear logs/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /clear traces/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /share redacted/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /email/i })).not.toBeInTheDocument();
  });

  it('filters diagnostics entries per tab and restores on clear', async () => {
    vi.mocked(getErrorLogs).mockReturnValue([
      { id: 'err-1', level: 'error', message: 'Disk error', timestamp: '2024-01-01T00:00:00.000Z', details: { code: 'E-1' } },
      { id: 'err-2', level: 'error', message: 'Network failure', timestamp: '2024-01-01T00:00:01.000Z', details: { code: 'E-2' } },
    ] as any);
    vi.mocked(getLogs).mockReturnValue([
      { id: 'log-1', level: 'info', message: 'Connection ready', timestamp: '2024-01-01T00:00:02.000Z' },
    ] as any);

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');

    const errorsTab = within(dialog).getByRole('tab', { name: /^Errors$/i });
    fireEvent.mouseDown(errorsTab);
    fireEvent.click(errorsTab);
    await waitFor(() => expect(errorsTab).toHaveAttribute('aria-selected', 'true'));

    const filterInput = within(dialog).getByTestId('diagnostics-filter-input');
    fireEvent.change(filterInput, { target: { value: 'network' } });
    expect((await within(dialog).findAllByText('Network failure')).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('Disk error')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /clear filter/i }));
    expect((await within(dialog).findAllByText('Disk error')).length).toBeGreaterThan(0);

    const logsTab = within(dialog).getByRole('tab', { name: /^Logs$/i });
    fireEvent.mouseDown(logsTab);
    fireEvent.click(logsTab);
    await waitFor(() => expect(logsTab).toHaveAttribute('aria-selected', 'true'));
    expect(within(dialog).getByTestId('diagnostics-filter-input')).toHaveValue('');
    expect((await within(dialog).findAllByText('Connection ready')).length).toBeGreaterThan(0);
  });

  it('filters diagnostics entries case-insensitively across timestamps and details', async () => {
    vi.mocked(getLogs).mockReturnValue([
      {
        id: 'log-1',
        level: 'info',
        message: 'System boot',
        timestamp: '2024-01-01T01:02:03.004Z',
        details: { note: 'MiXeDCase' },
      },
    ] as any);

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');
    const logsTab = within(dialog).getByRole('tab', { name: /^Logs$/i });
    fireEvent.mouseDown(logsTab);
    fireEvent.click(logsTab);
    await waitFor(() => expect(logsTab).toHaveAttribute('aria-selected', 'true'));

    const filterInput = within(dialog).getByTestId('diagnostics-filter-input');
    fireEvent.change(filterInput, { target: { value: 'mixedcase' } });
    expect((await within(dialog).findAllByText('System boot')).length).toBeGreaterThan(0);

    fireEvent.change(filterInput, { target: { value: '01:02:03.004' } });
    expect((await within(dialog).findAllByText('System boot')).length).toBeGreaterThan(0);

    fireEvent.change(filterInput, { target: { value: 'missing' } });
    expect(within(dialog).queryByText('System boot')).not.toBeInTheDocument();
  });

  it('clears diagnostics after confirmation', async () => {
    vi.mocked(getErrorLogs).mockReturnValue([
      { id: 'err-1', level: 'error', message: 'Error entry', timestamp: Date.now(), details: { boom: true } },
    ] as any);

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');
    const errorsTab = within(dialog).getByRole('tab', { name: /^Errors$/i });
    fireEvent.mouseDown(errorsTab);
    fireEvent.click(errorsTab);
    await waitFor(() => expect(errorsTab).toHaveAttribute('aria-selected', 'true'));
    expect((await within(dialog).findAllByText('Error entry')).length).toBeGreaterThan(0);

    const logsTab = within(dialog).getByRole('tab', { name: /^Logs$/i });
    fireEvent.mouseDown(logsTab);
    fireEvent.click(logsTab);
    await waitFor(() => expect(logsTab).toHaveAttribute('aria-selected', 'true'));
    vi.mocked(getLogs).mockReturnValue([
      { id: 'log-1', level: 'info', message: 'Log entry', timestamp: Date.now(), details: { ok: true } },
    ] as any);
    await act(async () => {
      window.dispatchEvent(new Event('c64u-logs-updated'));
    });
    expect((await within(dialog).findAllByText('Log entry')).length).toBeGreaterThan(0);

    const tracesTab = within(dialog).getByRole('tab', { name: /traces/i });
    fireEvent.mouseDown(tracesTab);
    fireEvent.click(tracesTab);
    await waitFor(() => expect(tracesTab).toHaveAttribute('aria-selected', 'true'));
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: 'trace-1',
        timestamp: new Date().toISOString(),
        relativeMs: 0,
        type: 'rest-request',
        origin: 'user',
        correlationId: 'COR-0000',
        data: { method: 'GET', url: '/v1/info' },
      },
    ] as any);
    await act(async () => {
      window.dispatchEvent(new Event('c64u-traces-updated'));
    });
    expect(await within(dialog).findByText(/REST GET/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /clear all/i }));
    const confirm = await screen.findByRole('alertdialog', { name: /clear diagnostics/i });
    expect(confirm).toHaveTextContent(
      'This will permanently clear all error logs, logs, traces, and actions. This cannot be undone.',
    );
    fireEvent.click(within(confirm).getByRole('button', { name: /clear/i }));

    expect(clearTraceEvents).toHaveBeenCalled();
    expect(clearLogs).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'Diagnostics cleared' });
  });

  it('requires confirmation to clear diagnostics', async () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /clear all/i }));
    const confirm = await screen.findByRole('alertdialog', { name: /clear diagnostics/i });
    fireEvent.click(within(confirm).getByRole('button', { name: /cancel/i }));

    expect(clearTraceEvents).not.toHaveBeenCalled();
    expect(clearLogs).not.toHaveBeenCalled();
  });

  it('renders action indicators with semantic colors', async () => {
    const base = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: 'evt-1',
        timestamp: new Date(base).toISOString(),
        relativeMs: 0,
        type: 'action-start',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { name: 'Play song', component: 'Test', context: {} },
      },
      {
        id: 'evt-2',
        timestamp: new Date(base + 10).toISOString(),
        relativeMs: 10,
        type: 'rest-request',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { method: 'GET', url: '/v1/info', normalizedUrl: '/v1/info', headers: {}, body: null, target: 'real-device' },
      },
      {
        id: 'evt-3',
        timestamp: new Date(base + 25).toISOString(),
        relativeMs: 25,
        type: 'rest-response',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { status: 200, durationMs: 15, error: null },
      },
      {
        id: 'evt-4',
        timestamp: new Date(base + 40).toISOString(),
        relativeMs: 40,
        type: 'ftp-operation',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { operation: 'list', path: '/', result: 'success', target: 'real-device' },
      },
      {
        id: 'evt-5',
        timestamp: new Date(base + 50).toISOString(),
        relativeMs: 50,
        type: 'error',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { message: 'Boom' },
      },
      {
        id: 'evt-6',
        timestamp: new Date(base + 60).toISOString(),
        relativeMs: 60,
        type: 'action-end',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { status: 'success', error: null },
      },
    ] as any);

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');
    const actionsTab = within(dialog).getByRole('tab', { name: /actions/i });
    fireEvent.mouseDown(actionsTab);
    fireEvent.click(actionsTab);
    await waitFor(() => expect(actionsTab).toHaveAttribute('aria-selected', 'true'));

    await act(async () => {
      window.dispatchEvent(new Event('c64u-traces-updated'));
    });

    const summary = await within(dialog).findByTestId('action-summary-COR-0001');
    expect(within(summary).getByLabelText('user')).toHaveClass('bg-diagnostics-user');
    expect(within(summary).getByTestId('action-rest-count-COR-0001')).toHaveClass('text-diagnostics-rest');
    expect(within(summary).getByTestId('action-ftp-count-COR-0001')).toHaveClass('text-diagnostics-ftp');
    expect(within(summary).getByTestId('action-error-count-COR-0001')).toHaveClass('text-diagnostics-error');
    expect(within(summary).getByText(/\d+\sms/, { selector: 'div' })).toBeInTheDocument();
  });

  it('uses shared renderer for traces and actions', async () => {
    const base = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: 'trace-1',
        timestamp: new Date(base).toISOString(),
        relativeMs: 0,
        type: 'rest-request',
        origin: 'user',
        correlationId: 'COR-0100',
        data: { method: 'GET', url: '/v1/info' },
      },
      {
        id: 'trace-2',
        timestamp: new Date(base + 10).toISOString(),
        relativeMs: 10,
        type: 'action-start',
        origin: 'user',
        correlationId: 'COR-0100',
        data: { name: 'Inspect', component: 'Test', context: {} },
      },
      {
        id: 'trace-3',
        timestamp: new Date(base + 20).toISOString(),
        relativeMs: 20,
        type: 'action-end',
        origin: 'user',
        correlationId: 'COR-0100',
        data: { status: 'success', error: null },
      },
    ] as any);

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');

    await act(async () => {
      window.dispatchEvent(new Event('c64u-traces-updated'));
    });

    const tracesTab = within(dialog).getByRole('tab', { name: /traces/i });
    fireEvent.mouseDown(tracesTab);
    fireEvent.click(tracesTab);
    await waitFor(() => expect(tracesTab).toHaveAttribute('aria-selected', 'true'));

    const traceItem = await within(dialog).findByTestId('trace-item-trace-1');
    expect(traceItem.querySelector('[data-testid="diagnostics-summary-grid"]')).toBeTruthy();

    const actionsTab = within(dialog).getByRole('tab', { name: /actions/i });
    fireEvent.mouseDown(actionsTab);
    fireEvent.click(actionsTab);
    await waitFor(() => expect(actionsTab).toHaveAttribute('aria-selected', 'true'));

    const actionItem = await within(dialog).findByTestId('action-summary-COR-0100');
    expect(actionItem.querySelector('[data-testid="diagnostics-summary-grid"]')).toBeTruthy();
  });

  it('exports active diagnostics tab and reports failures', async () => {
    vi.mocked(shareDiagnosticsZip).mockImplementation(() => undefined);

    renderSettingsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    const dialog = await screen.findByRole('dialog');
    const tracesTab = within(dialog).getByRole('tab', { name: /traces/i });
    fireEvent.mouseDown(tracesTab);
    fireEvent.click(tracesTab);
    await waitFor(() => expect(tracesTab).toHaveAttribute('aria-selected', 'true'));
    vi.mocked(getTraceEvents).mockReturnValue([
      {
        id: 'trace-1',
        timestamp: new Date().toISOString(),
        relativeMs: 0,
        type: 'rest-request',
        origin: 'user',
        correlationId: 'COR-0000',
        data: { method: 'GET', url: '/v1/info' },
      },
    ] as any);
    await act(async () => {
      window.dispatchEvent(new Event('c64u-traces-updated'));
    });
    fireEvent.click(await within(dialog).findByTestId('diagnostics-share-traces'));

    expect(shareDiagnosticsZip).toHaveBeenCalledWith('traces', expect.any(Array));

    vi.mocked(shareDiagnosticsZip).mockImplementation(() => {
      throw new Error('export failed');
    });

    fireEvent.click(await within(dialog).findByTestId('diagnostics-share-traces'));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'DIAGNOSTICS_EXPORT',
      }));
    });
  });

  it('requires confirmation when switching into relaxed safety mode', async () => {
    const saveSpy = vi.spyOn(deviceSafetySettings, 'saveDeviceSafetyMode');

    renderSettingsPage();

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

    renderSettingsPage();

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

    renderSettingsPage();

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

    renderSettingsPage();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'SETTINGS_IMPORT',
      }));
    });
  });

  it('enables debug logging when switching to troubleshooting mode', () => {
    renderSettingsPage();

    const trigger = screen.getAllByRole('combobox')[1];
    fireEvent.change(trigger, { target: { value: 'TROUBLESHOOTING' } });

    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
  });
});
