/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/SettingsPage";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { reportUserError } from "@/lib/uiErrors";
import { FolderPicker } from "@/lib/native/folderPicker";
import { discoverConnection } from "@/lib/connection/connectionManager";
import { setPasswordForDevice } from "@/lib/secureStorage";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, clearLogs, getErrorLogs, getLogs } from "@/lib/logging";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import {
  saveArchiveClientIdOverride,
  saveArchiveHostOverride,
  saveArchiveUserAgentOverride,
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDebugLoggingEnabled,
  saveDiscoveryProbeTimeoutMs,
  saveStartupDiscoveryWindowMs,
  saveVolumeSliderPreviewIntervalMs,
} from "@/lib/config/appSettings";
import * as deviceSafetySettings from "@/lib/config/deviceSafetySettings";
import { exportSettingsJson, importSettingsJson } from "@/lib/config/settingsTransfer";
import {
  loadConfigWriteIntervalMs,
  loadAutomaticDemoModeEnabled,
  loadStartupDiscoveryWindowMs,
  loadBackgroundRediscoveryIntervalMs,
  loadDiscoveryProbeTimeoutMs,
  loadDiskAutostartMode,
  loadVolumeSliderPreviewIntervalMs,
} from "@/lib/config/appSettings";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
    li: ({ children, ...props }: any) => <li {...props}>{children}</li>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ui/select", () => ({
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
  mockGetSavedDeviceDependencySummary,
  mockSetFeatureFlag,
  mockPrimeDiagnosticsOverlaySuppression,
  mockRequestDiagnosticsOpen,
  mockSetTheme,
  mockSetListPreviewLimit,
  mockSwitchSavedDevice,
  connectionPayloadRef,
  connectionStateRef,
  developerModeEnabledRef,
  featureFlagsRef,
  savedDevicesRef,
} = vi.hoisted(() => ({
  mockUpdateConfig: vi.fn(),
  mockRefetch: vi.fn(),
  mockEnableDeveloperMode: vi.fn(),
  mockGetSavedDeviceDependencySummary: vi.fn(async () => ({ diskCount: 0, playlistItemCount: 0, totalCount: 0 })),
  mockSetFeatureFlag: vi.fn(async () => undefined),
  mockPrimeDiagnosticsOverlaySuppression: vi.fn(),
  mockRequestDiagnosticsOpen: vi.fn(),
  mockSetTheme: vi.fn(),
  mockSetListPreviewLimit: vi.fn(),
  mockSwitchSavedDevice: vi.fn(async () => undefined),
  featureFlagsRef: {
    current: {
      hvsc_enabled: true,
    },
  },
  savedDevicesRef: {
    current: {
      selectedDeviceId: "saved-device-1",
      devices: [
        {
          id: "saved-device-1",
          name: "Office U64",
          host: "c64u",
          httpPort: 80,
          ftpPort: 21,
          telnetPort: 64,
          lastKnownProduct: "U64",
          lastKnownHostname: "office-u64",
          lastKnownUniqueId: "UID-1",
          lastSuccessfulConnectionAt: null,
          lastUsedAt: null,
          hasPassword: false,
        },
      ],
      summaries: {},
      summaryLru: [],
      runtimeStatuses: {},
      verifiedByDeviceId: {},
      actualDeviceIdByDeviceId: {},
    },
  },
  connectionPayloadRef: {
    current: {
      status: {
        state: "OFFLINE_NO_DEMO",
        isConnected: false,
        isConnecting: false,
        error: null,
        deviceInfo: null,
      },
      baseUrl: "http://c64u",
      runtimeBaseUrl: "http://c64u",
      password: "",
      deviceHost: "c64u",
    },
  },
  connectionStateRef: {
    current: {
      lastProbeSucceededAtMs: null as number | null,
      lastProbeFailedAtMs: null as number | null,
    },
  },
  developerModeEnabledRef: { current: false },
}));

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
  useC64Connection: () => ({
    ...connectionPayloadRef.current,
    updateConfig: mockUpdateConfig,
    refetch: mockRefetch,
  }),
}));

vi.mock("@/hooks/useSavedDevices", () => ({
  useSavedDevices: () => savedDevicesRef.current,
}));

vi.mock("@/hooks/useSavedDeviceSwitching", () => ({
  useSavedDeviceSwitching: () => mockSwitchSavedDevice,
}));

vi.mock("@/lib/secureStorage", () => ({
  getPasswordForDevice: vi.fn(async () => null),
  setPasswordForDevice: vi.fn(async () => undefined),
  clearPasswordForDevice: vi.fn(async () => undefined),
}));

vi.mock("@/lib/savedDevices/deviceDependencies", () => ({
  getSavedDeviceDependencySummary: mockGetSavedDeviceDependencySummary,
}));

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => connectionStateRef.current,
}));

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => ({
    theme: "light",
    setTheme: mockSetTheme,
  }),
}));

vi.mock("@/components/UnifiedHealthBadge", () => ({
  UnifiedHealthBadge: () => null,
}));

vi.mock("@/hooks/useDeveloperMode", () => ({
  useDeveloperMode: () => ({
    isDeveloperModeEnabled: developerModeEnabledRef.current,
    enableDeveloperMode: mockEnableDeveloperMode,
  }),
}));

vi.mock("@/hooks/useListPreviewLimit", () => ({
  useListPreviewLimit: () => ({
    limit: 50,
    setLimit: mockSetListPreviewLimit,
  }),
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: (key: "hvsc_enabled") => ({
    value: featureFlagsRef.current[key],
    isLoaded: true,
    setValue: mockSetFeatureFlag,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

const buildRouter = (ui: JSX.Element) =>
  createMemoryRouter([{ path: "*", element: ui }], {
    initialEntries: ["/"],
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  });

const renderSettingsPage = () =>
  render(
    <RouterProvider
      router={buildRouter(<SettingsPage />)}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    />,
  );

const renderSettingsPageWithDisplayProfileProvider = () =>
  render(
    <DisplayProfileProvider>
      <RouterProvider
        router={buildRouter(<SettingsPage />)}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />
    </DisplayProfileProvider>,
  );

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  clearLogs: vi.fn(),
  formatLogsForShare: vi.fn(() => "payload"),
  getErrorLogs: vi.fn(() => []),
  getLogs: vi.fn(() => []),
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => "android",
  isNativePlatform: () => true,
}));

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    getPersistedUris: vi.fn(),
    listChildren: vi.fn(),
  },
}));

vi.mock("@/lib/native/safUtils", () => ({
  redactTreeUri: (value: string) => value,
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  discoverConnection: vi.fn(),
  dismissDemoInterstitial: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  requestDiagnosticsOpen: mockRequestDiagnosticsOpen,
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  primeDiagnosticsOverlaySuppression: mockPrimeDiagnosticsOverlaySuppression,
  shouldSuppressDiagnosticsSideEffects: () => false,
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordActionStart: vi.fn(),
  recordActionEnd: vi.fn(),
  recordActionScopeStart: vi.fn(),
  recordActionScopeEnd: vi.fn(),
  recordTraceError: vi.fn(),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () =>
    Object.assign(<T extends (...args: any[]) => any>(fn: T) => fn, {
      scope: async () => undefined,
    }),
}));

vi.mock("@/lib/tracing/traceExport", () => ({}));

vi.mock("@/lib/config/settingsTransfer", () => ({
  exportSettingsJson: vi.fn(() => '{"version":1}'),
  importSettingsJson: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/config/appSettings", () => ({
  clampConfigWriteIntervalMs: (value: number) => value,
  clampDiscoveryProbeTimeoutMs: (value: number) => value,
  clampVolumeSliderPreviewIntervalMs: (value: number) => value,
  loadConfigWriteIntervalMs: vi.fn(() => 500),
  clampBackgroundRediscoveryIntervalMs: (value: number) => value,
  clampStartupDiscoveryWindowMs: (value: number) => value,
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadBackgroundRediscoveryIntervalMs: vi.fn(() => 5000),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 3000),
  loadDebugLoggingEnabled: vi.fn(() => true),
  loadDiskAutostartMode: vi.fn(() => "kernal"),
  loadVolumeSliderPreviewIntervalMs: vi.fn(() => 200),
  loadArchiveClientIdOverride: vi.fn(() => ""),
  loadArchiveHostOverride: vi.fn(() => ""),
  loadArchiveUserAgentOverride: vi.fn(() => ""),
  saveAutomaticDemoModeEnabled: vi.fn(),
  saveArchiveHostOverride: vi.fn(),
  saveArchiveClientIdOverride: vi.fn(),
  saveArchiveUserAgentOverride: vi.fn(),
  loadCommoserveEnabled: vi.fn(() => true),
  saveCommoserveEnabled: vi.fn(),
  saveBackgroundRediscoveryIntervalMs: vi.fn(),
  saveDiscoveryProbeTimeoutMs: vi.fn(),
  saveStartupDiscoveryWindowMs: vi.fn(),
  saveConfigWriteIntervalMs: vi.fn(),
  saveDebugLoggingEnabled: vi.fn(),
  saveDiskAutostartMode: vi.fn(),
  saveVolumeSliderPreviewIntervalMs: vi.fn(),
  loadNotificationVisibility: vi.fn(() => "errors-only"),
  saveNotificationVisibility: vi.fn(),
  loadNotificationDurationMs: vi.fn(() => 4000),
  saveNotificationDurationMs: vi.fn(),
  NOTIFICATION_DURATION_MIN_MS: 2000,
  NOTIFICATION_DURATION_MAX_MS: 8000,
  loadAutoRotationEnabled: vi.fn(() => false),
  saveAutoRotationEnabled: vi.fn(),
  APP_SETTINGS_KEYS: {
    NOTIFICATION_DURATION_MS_KEY: "c64u_notification_duration_ms",
    AUTO_ROTATION_ENABLED_KEY: "c64u_auto_rotation_enabled",
  },
}));

vi.mock("@/components/archive/OnlineArchiveDialog", () => ({
  OnlineArchiveDialog: ({ open, config }: { open: boolean; config: { id: string; baseUrl: string } }) =>
    open ? (
      <div data-testid="online-archive-dialog-mock">
        {config.id}:{config.baseUrl}
      </div>
    ) : null,
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  savedDevicesRef.current = {
    selectedDeviceId: "saved-device-1",
    devices: [
      {
        id: "saved-device-1",
        name: "Office U64",
        host: "c64u",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 64,
        lastKnownProduct: "U64",
        lastKnownHostname: "office-u64",
        lastKnownUniqueId: "UID-1",
        lastSuccessfulConnectionAt: null,
        lastUsedAt: null,
        hasPassword: false,
      },
    ],
    summaries: {},
    summaryLru: [],
    runtimeStatuses: {},
    verifiedByDeviceId: {},
    actualDeviceIdByDeviceId: {},
  };
  localStorage.clear();
  localStorage.setItem(
    "c64u_saved_devices:v1",
    JSON.stringify({
      version: 1,
      selectedDeviceId: savedDevicesRef.current.selectedDeviceId,
      devices: savedDevicesRef.current.devices,
      summaries: {},
      summaryLru: [],
    }),
  );
  connectionPayloadRef.current = {
    status: {
      state: "OFFLINE_NO_DEMO",
      isConnected: false,
      isConnecting: false,
      error: null,
      deviceInfo: null,
    },
    baseUrl: "http://c64u",
    runtimeBaseUrl: "http://c64u",
    password: "",
    deviceHost: "c64u",
  };
  connectionStateRef.current = {
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
  };
  developerModeEnabledRef.current = false;
  featureFlagsRef.current.hvsc_enabled = true;
  mockSetFeatureFlag.mockReset();
  vi.mocked(getLogs).mockReturnValue([]);
  vi.mocked(getErrorLogs).mockReturnValue([]);
  vi.mocked(requestDiagnosticsOpen).mockReset();
  mockPrimeDiagnosticsOverlaySuppression.mockReset();
});

describe("SettingsPage", () => {
  vi.setConfig({ testTimeout: 20000 });

  const buildFileList = (file: File) => {
    if (typeof DataTransfer !== "undefined") {
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
  it("saves connection settings and relies on saved-device verification", async () => {
    mockSwitchSavedDevice.mockResolvedValue(undefined);

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u", undefined);
      expect(mockSwitchSavedDevice).toHaveBeenCalledWith("saved-device-1");
      expect(discoverConnection).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Connection settings saved" }));
    });
  }, 15000);

  it("persists HTTP, FTP, and Telnet ports when saving connection settings", async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPage();

    fireEvent.change(screen.getByLabelText(/http port/i), { target: { value: "8081" } });
    fireEvent.change(screen.getByLabelText(/ftp port/i), { target: { value: "2121" } });
    fireEvent.change(screen.getByLabelText(/telnet port/i), { target: { value: "2323" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u:8081", undefined);
      expect(localStorage.getItem("c64u_ftp_port")).toBe("2121");
      expect(localStorage.getItem("c64u_telnet_port")).toBe("2323");
    });
  });

  it("persists the saved-device password flag before switching devices", async () => {
    renderSettingsPage();

    fireEvent.change(screen.getByLabelText(/password|network password/i), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(vi.mocked(setPasswordForDevice)).toHaveBeenCalledWith("saved-device-1", "new-password");
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u", "new-password");
      const persisted = JSON.parse(localStorage.getItem("c64u_saved_devices:v1") ?? "{}");
      expect(persisted.devices[0]).toMatchObject({
        id: "saved-device-1",
        hasPassword: true,
      });
    });
  });

  it("removes badge-label authoring and keeps a blank device name on the product-based auto label path", async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPage();

    expect(screen.queryByLabelText(/badge label/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/device name/i), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/c64u hostname \/ ip/i), { target: { value: "ultimate.local" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("ultimate.local", undefined);
    });

    const persisted = JSON.parse(localStorage.getItem("c64u_saved_devices:v1") ?? "{}");
    expect(persisted.devices[0]).toMatchObject({
      id: "saved-device-1",
      name: "",
      nameSource: "auto",
      host: "ultimate.local",
    });
  });

  it("warns before deleting a device that is still referenced by playlists or disks", async () => {
    savedDevicesRef.current = {
      ...savedDevicesRef.current,
      devices: [
        ...savedDevicesRef.current.devices,
        {
          id: "saved-device-2",
          name: "Backup U64",
          host: "backup-u64",
          httpPort: 80,
          ftpPort: 21,
          telnetPort: 64,
          lastKnownProduct: "U64",
          lastKnownHostname: "backup-u64",
          lastKnownUniqueId: "UID-2",
          lastSuccessfulConnectionAt: null,
          lastUsedAt: null,
          hasPassword: false,
        },
      ],
    };
    localStorage.setItem(
      "c64u_saved_devices:v1",
      JSON.stringify({
        version: 1,
        selectedDeviceId: savedDevicesRef.current.selectedDeviceId,
        devices: savedDevicesRef.current.devices,
        summaries: {},
        summaryLru: [],
      }),
    );
    mockGetSavedDeviceDependencySummary.mockResolvedValue({
      diskCount: 2,
      playlistItemCount: 3,
      totalCount: 5,
    });
    const beforeDelete = localStorage.getItem("c64u_saved_devices:v1");

    renderSettingsPage();

    fireEvent.click(screen.getByTestId("settings-delete-device"));

    await waitFor(() => {
      expect(mockGetSavedDeviceDependencySummary).toHaveBeenCalledWith("saved-device-1");
    });
    const deleteDialog = screen.getByRole("alertdialog", { name: /delete device/i });
    expect(
      within(deleteDialog).getByText(/those items will stay in your playlists and disk library/i),
    ).toBeInTheDocument();
    expect(
      within(deleteDialog).getByText(/after you delete the device, those items will no longer open/i),
    ).toBeInTheDocument();
    expect(mockSwitchSavedDevice).not.toHaveBeenCalled();
    expect(localStorage.getItem("c64u_saved_devices:v1")).toBe(beforeDelete);
  });

  it("uses icon-only saved-device actions and shows the HVSC settings card", () => {
    renderSettingsPage();

    expect(screen.getByTestId("settings-add-device")).toHaveAccessibleName("Add device");
    expect(screen.getByTestId("settings-delete-device")).toHaveAccessibleName("Delete device");
    expect(screen.getByRole("heading", { name: "HVSC" })).toBeInTheDocument();
    expect(screen.getByText(/enable hvsc downloads/i)).toBeInTheDocument();
  });

  it("orders core sections and places network timing under Device Safety", () => {
    renderSettingsPage();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent ?? "");
    const appearanceIndex = headings.indexOf("Appearance");
    const connectionIndex = headings.indexOf("Connection");
    const diagnosticsIndex = headings.indexOf("Diagnostics");
    const deviceSafetyIndex = headings.indexOf("Device Safety");
    const aboutIndex = headings.indexOf("About");

    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(connectionIndex).toBeGreaterThan(appearanceIndex);
    expect(diagnosticsIndex).toBeGreaterThan(connectionIndex);
    expect(deviceSafetyIndex).toBeGreaterThan(diagnosticsIndex);
    expect(aboutIndex).toBeGreaterThan(deviceSafetyIndex);
    expect(aboutIndex).toBe(headings.length - 1);

    const connectionSection = screen.getByRole("heading", { name: "Connection" }).closest(".rounded-xl");
    const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-xl");

    expect(connectionSection).toBeTruthy();
    expect(deviceSafetySection).toBeTruthy();

    if (connectionSection) {
      expect(within(connectionSection).queryByText("Startup Discovery Window (seconds)")).toBeNull();
      expect(within(connectionSection).queryByText("Background Rediscovery Interval (seconds)")).toBeNull();
      expect(within(connectionSection).queryByText("Discovery Probe Timeout (seconds)")).toBeNull();
    }

    if (deviceSafetySection) {
      expect(within(deviceSafetySection).getByText("Startup Discovery Window (seconds)")).toBeInTheDocument();
      expect(within(deviceSafetySection).getByText("Background Rediscovery Interval (seconds)")).toBeInTheDocument();
      expect(within(deviceSafetySection).getByText("Discovery Probe Timeout (seconds)")).toBeInTheDocument();
    }
  });

  it("reports connection save errors", async () => {
    mockSwitchSavedDevice.mockRejectedValueOnce(new Error("Boom"));

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CONNECTION_SAVE",
        }),
      );
    });
  });

  it("persists demo mode and debug logging toggles", () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole("checkbox", { name: /automatic demo mode/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /enable debug logging/i }));

    expect(saveAutomaticDemoModeEnabled).toHaveBeenCalledWith(false);
    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(false);
  });

  it("saves discovery window inputs on blur", () => {
    renderSettingsPage();

    const startupInput = screen.getByLabelText(/startup discovery window/i);
    const backgroundInput = screen.getByLabelText(/background rediscovery interval/i);

    fireEvent.change(startupInput, { target: { value: "4" } });
    fireEvent.blur(startupInput);
    fireEvent.change(backgroundInput, { target: { value: "6" } });
    fireEvent.blur(backgroundInput);

    expect(saveStartupDiscoveryWindowMs).toHaveBeenCalledWith(4000);
    expect(saveBackgroundRediscoveryIntervalMs).toHaveBeenCalledWith(6000);
  });

  it("commits list preview limit changes", () => {
    renderSettingsPage();

    const input = screen.getByLabelText(/list preview limit/i);
    fireEvent.change(input, { target: { value: "75" } });
    fireEvent.blur(input);

    expect(mockSetListPreviewLimit).toHaveBeenCalledWith(75);
  });

  it("changes theme when selecting a new option", () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /dark/i }));

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("changes theme when selecting the auto option", () => {
    renderSettingsPage();

    const appearanceSection = screen.getByRole("heading", { name: "Appearance" }).closest(".rounded-xl");
    expect(appearanceSection).toBeTruthy();
    if (!appearanceSection) return;

    fireEvent.click(within(appearanceSection).getAllByRole("button")[0]);

    expect(mockSetTheme).toHaveBeenCalledWith("system");
  });

  it("shows appearance theme options in auto light dark order", () => {
    renderSettingsPage();

    const appearanceSection = screen.getByRole("heading", { name: "Appearance" }).closest(".rounded-xl");
    expect(appearanceSection).toBeTruthy();
    if (!appearanceSection) return;

    const buttons = within(appearanceSection).getAllByRole("button");
    const themeLabels = buttons.slice(0, 3).map((button) => button.textContent?.trim() ?? "");
    expect(themeLabels).toEqual(["Auto", "Light", "Dark"]);
  });

  it("persists display profile overrides and reports the auto compact resolution", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
      writable: true,
    });

    renderSettingsPageWithDisplayProfileProvider();

    expect(screen.getByText(/Auto currently resolves to Small display\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Large display" }));

    expect(localStorage.getItem("c64u_display_profile_override")).toBe("expanded");
    expect(document.documentElement.dataset.displayProfile).toBe("expanded");
  });

  it("shows persisted SAF URIs after refresh", async () => {
    vi.mocked(FolderPicker.getPersistedUris).mockResolvedValue({
      uris: [{ uri: "content://example" }],
    });
    vi.mocked(FolderPicker.listChildren).mockResolvedValue({
      entries: [{ name: "Root", path: "/", type: "dir" }],
    });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /list persisted uris/i }));

    await waitFor(() => {
      expect(FolderPicker.getPersistedUris).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /enumerate first root/i }));

    await waitFor(() => {
      expect(FolderPicker.listChildren).toHaveBeenCalled();
    });

    expect(screen.getByText(/persisted:/i)).toHaveTextContent("content://example");
    expect(screen.getByText(/dir: \//i)).toBeInTheDocument();
  }, 15000);

  it("enables developer mode after repeated taps", () => {
    renderSettingsPage();

    const aboutCard = screen.getByRole("button", { name: /about/i });
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(aboutCard);
    }

    expect(mockEnableDeveloperMode).toHaveBeenCalled();
  });

  it("reports missing SAF permissions before enumeration", async () => {
    vi.mocked(FolderPicker.getPersistedUris).mockResolvedValue({
      uris: [{ uri: "" }],
    });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /list persisted uris/i }));

    await waitFor(() => {
      expect(FolderPicker.getPersistedUris).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /enumerate first root/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "SAF_DIAGNOSTICS",
        }),
      );
    });
  }, 15000);

  it("shows demo probe messaging when demo is active", () => {
    connectionPayloadRef.current = {
      ...connectionPayloadRef.current,
      status: {
        state: "DEMO_ACTIVE",
        isConnected: true,
        isConnecting: false,
        error: null,
        deviceInfo: null,
      },
    };
    connectionStateRef.current = {
      lastProbeSucceededAtMs: Date.now(),
      lastProbeFailedAtMs: null,
    };

    renderSettingsPage();

    expect(screen.getByText(/real device detected during probe/i)).toBeInTheDocument();
  });

  it("shows waiting demo probe messaging before the first probe completes", () => {
    connectionPayloadRef.current = {
      ...connectionPayloadRef.current,
      status: {
        state: "DEMO_ACTIVE",
        isConnected: true,
        isConnecting: false,
        error: null,
        deviceInfo: null,
      },
    };
    connectionStateRef.current = {
      lastProbeSucceededAtMs: null,
      lastProbeFailedAtMs: null,
    };

    renderSettingsPage();

    expect(screen.getByText(/waiting for initial probe/i)).toBeInTheDocument();
  });

  it("shows failed demo probe messaging after an unsuccessful probe", () => {
    connectionPayloadRef.current = {
      ...connectionPayloadRef.current,
      status: {
        state: "DEMO_ACTIVE",
        isConnected: true,
        isConnecting: false,
        error: null,
        deviceInfo: null,
      },
    };
    connectionStateRef.current = {
      lastProbeSucceededAtMs: null,
      lastProbeFailedAtMs: Date.now(),
    };

    renderSettingsPage();

    expect(screen.getByText(/no real device detected in recent probe/i)).toBeInTheDocument();
  });

  it("shows the connected status message when a real device is connected", () => {
    connectionPayloadRef.current = {
      ...connectionPayloadRef.current,
      status: {
        state: "CONNECTED",
        isConnected: true,
        isConnecting: false,
        error: null,
        deviceInfo: null,
      },
      baseUrl: "http://c64u",
    };

    renderSettingsPage();

    expect(screen.getByText("Connected to http://c64u")).toBeInTheDocument();
  });

  it("shows the connecting state and spinning refresh icon while connecting", () => {
    connectionPayloadRef.current = {
      ...connectionPayloadRef.current,
      status: {
        state: "CONNECTING",
        isConnected: false,
        isConnecting: true,
        error: null,
        deviceInfo: null,
      },
    };

    renderSettingsPage();

    expect(screen.getByText("Connecting...")).toBeInTheDocument();
    expect(screen.getByLabelText("Refresh connection").querySelector("svg")).toHaveClass("animate-spin");
  });

  it("uses the default device host when saving an empty hostname", async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPage();

    const hostnameInput = screen.getByLabelText(/c64u hostname \/ ip/i);
    fireEvent.change(hostnameInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u", undefined);
    });
  });

  it("does not re-enable developer mode when it is already active", () => {
    developerModeEnabledRef.current = true;

    renderSettingsPage();

    const aboutCard = screen.getByRole("button", { name: /about/i });
    for (let index = 0; index < 7; index += 1) {
      fireEvent.click(aboutCard);
    }

    expect(mockEnableDeveloperMode).not.toHaveBeenCalled();
  });

  it("commits a zero probe timeout when the number input is cleared", () => {
    renderSettingsPage();

    const input = screen.getByLabelText(/discovery probe timeout/i);
    fireEvent.change(input, { target: { value: "not-a-number" } });
    fireEvent.blur(input);

    expect(saveDiscoveryProbeTimeoutMs).toHaveBeenCalledWith(0);
  });

  it("reports settings export failures", () => {
    const createObjectURL = vi.fn(() => {
      throw new Error("export blocked");
    });
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /export settings/i }));

    expect(reportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "SETTINGS_EXPORT",
        description: "export blocked",
      }),
    );
  });

  it("reports file read failures during settings import", async () => {
    const file = new File(["{}"], "settings.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () => {
        throw new Error("read failed");
      }),
    });

    renderSettingsPage();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "SETTINGS_IMPORT",
          description: "read failed",
        }),
      );
    });
  });

  it("requests the global diagnostics overlay from the settings trigger", () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));

    expect(mockPrimeDiagnosticsOverlaySuppression).toHaveBeenCalled();
    expect(requestDiagnosticsOpen).toHaveBeenCalledWith("settings");
  });

  it("validates archive host overrides and falls back to the default host", () => {
    renderSettingsPage();

    fireEvent.change(screen.getByLabelText("Host override"), {
      target: { value: "http://bad-host" },
    });

    expect(saveArchiveHostOverride).toHaveBeenCalledWith("http://bad-host");
    expect(screen.getByRole("alert")).toHaveTextContent(/hostname only/i);
    expect(screen.getByText(/Resolved host:/i)).toHaveTextContent("commoserve.files.commodore.net");
  });

  it("persists archive overrides and mounts the archive dialog only when opened", () => {
    renderSettingsPage();

    expect(screen.queryByTestId("online-archive-dialog-mock")).toBeNull();

    fireEvent.change(screen.getByLabelText("Client-Id override"), {
      target: { value: "Custom Client" },
    });
    fireEvent.change(screen.getByLabelText("User-Agent override"), {
      target: { value: "Custom Agent" },
    });

    expect(saveArchiveClientIdOverride).toHaveBeenCalledWith("Custom Client");
    expect(saveArchiveUserAgentOverride).toHaveBeenCalledWith("Custom Agent");

    fireEvent.click(screen.getByRole("button", { name: /Open archive browser/i }));
    expect(screen.getByTestId("online-archive-dialog-mock")).toHaveTextContent(
      "archive-commoserve:http://commoserve.files.commodore.net",
    );
  });

  it("requires confirmation when switching into relaxed safety mode", async () => {
    const saveSpy = vi.spyOn(deviceSafetySettings, "saveDeviceSafetyMode");

    renderSettingsPage();

    const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-xl");
    expect(deviceSafetySection).toBeTruthy();
    const trigger = within(deviceSafetySection as HTMLElement).getByRole("combobox");
    fireEvent.change(trigger, { target: { value: "RELAXED" } });

    const warningDialog = await screen.findByRole("dialog", {
      name: /enable relaxed safety mode/i,
    });
    expect(warningDialog).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();

    fireEvent.click(within(warningDialog).getByRole("button", { name: /enable relaxed/i }));
    expect(saveSpy).toHaveBeenCalledWith("RELAXED");
  });

  it("feeds persisted safety mode changes into the runtime interaction scheduler", async () => {
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;

    try {
      renderSettingsPage();

      const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-xl");
      expect(deviceSafetySection).toBeTruthy();
      const trigger = within(deviceSafetySection as HTMLElement).getByRole("combobox");
      fireEvent.change(trigger, { target: { value: "CONSERVATIVE" } });

      expect(deviceSafetySettings.loadDeviceSafetyConfig().mode).toBe("CONSERVATIVE");

      const { updateDeviceConnectionState } = await import("@/lib/deviceInteraction/deviceStateStore");
      const { resetInteractionState, withFtpInteraction } =
        await import("@/lib/deviceInteraction/deviceInteractionManager");

      updateDeviceConnectionState("REAL_CONNECTED");
      resetInteractionState("settings-page-test");

      let activeHandlers = 0;
      let maxActiveHandlers = 0;
      const handler = vi.fn(async () => {
        activeHandlers += 1;
        maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            activeHandlers -= 1;
            resolve();
          }, 25);
        });
      });

      await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          withFtpInteraction(
            {
              action: {
                correlationId: `settings-safety-${index}`,
                origin: "user",
                name: `settings-safety-${index}`,
                componentName: "SettingsPage.test",
              },
              operation: "list",
              path: `/disk-${index}`,
              intent: "system",
            },
            handler,
          ),
        ),
      );

      expect(maxActiveHandlers).toBe(1);
    } finally {
      const { updateDeviceConnectionState } = await import("@/lib/deviceInteraction/deviceStateStore");
      updateDeviceConnectionState("UNKNOWN");
      delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    }
  });

  it("exports settings and shows a toast", async () => {
    const createObjectURL = vi.fn(() => "blob:settings");
    const revokeObjectURL = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        (element as HTMLAnchorElement).click = vi.fn();
      }
      return element;
    });
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /export settings/i }));

    expect(exportSettingsJson).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: "Settings export ready" });
    createElementSpy.mockRestore();
  });

  it("imports settings and refreshes local state", async () => {
    vi.mocked(importSettingsJson).mockReturnValue({ ok: true });
    const file = new File(['{"version":1}'], "settings.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () => '{"version":1}'),
    });

    renderSettingsPage();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      expect(importSettingsJson).toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith({ title: "Settings imported" });
    });
  });

  it("reports import validation errors", async () => {
    vi.mocked(importSettingsJson).mockReturnValue({
      ok: false,
      error: "Invalid payload",
    });
    const file = new File(['{"version":1}'], "settings.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () => '{"version":1}'),
    });

    renderSettingsPage();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "SETTINGS_IMPORT",
        }),
      );
    });
  });

  it("enables debug logging when switching to troubleshooting mode", () => {
    renderSettingsPage();

    const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-xl");
    expect(deviceSafetySection).toBeTruthy();
    const trigger = within(deviceSafetySection as HTMLElement).getByRole("combobox");
    fireEvent.change(trigger, { target: { value: "TROUBLESHOOTING" } });

    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
  });

  it("responds to c64u-app-settings-updated events for all tracked keys", async () => {
    renderSettingsPage();

    // Reset call counts after initial render
    vi.mocked(loadConfigWriteIntervalMs).mockClear();
    vi.mocked(loadAutomaticDemoModeEnabled).mockClear();
    vi.mocked(loadStartupDiscoveryWindowMs).mockClear();
    vi.mocked(loadBackgroundRediscoveryIntervalMs).mockClear();
    vi.mocked(loadDiscoveryProbeTimeoutMs).mockClear();
    vi.mocked(loadDiskAutostartMode).mockClear();
    vi.mocked(loadVolumeSliderPreviewIntervalMs).mockClear();

    const keys = [
      // debug_logging uses a direct state setter (no load function)
      "c64u_debug_logging_enabled",
      "c64u_config_write_min_interval_ms",
      "c64u_automatic_demo_mode_enabled",
      "c64u_startup_discovery_window_ms",
      "c64u_background_rediscovery_interval_ms",
      "c64u_discovery_probe_timeout_ms",
      "c64u_disk_autostart_mode",
      "c64u_volume_slider_preview_interval_ms",
    ];

    for (const key of keys) {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("c64u-app-settings-updated", {
            detail: { key, value: true },
          }),
        );
      });
    }

    expect(vi.mocked(loadConfigWriteIntervalMs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadAutomaticDemoModeEnabled)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadStartupDiscoveryWindowMs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadBackgroundRediscoveryIntervalMs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadDiscoveryProbeTimeoutMs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadDiskAutostartMode)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadVolumeSliderPreviewIntervalMs)).toHaveBeenCalledTimes(1);
  });

  it("ignores c64u-app-settings-updated events with no key", async () => {
    renderSettingsPage();

    const callsBefore = vi.mocked(loadConfigWriteIntervalMs).mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: {} }));
    });

    expect(vi.mocked(loadConfigWriteIntervalMs).mock.calls.length).toBe(callsBefore);
  });

  it("saves the device slider preview interval on blur and enter", () => {
    renderSettingsPage();

    vi.mocked(loadVolumeSliderPreviewIntervalMs).mockReturnValue(345);
    window.dispatchEvent(
      new CustomEvent("c64u-app-settings-updated", {
        detail: { key: "c64u_volume_slider_preview_interval_ms" },
      }),
    );

    const input = screen.getByLabelText(/slider preview interval/i);
    fireEvent.change(input, { target: { value: "345" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(saveVolumeSliderPreviewIntervalMs).toHaveBeenCalledWith(345);
    expect(saveVolumeSliderPreviewIntervalMs).toHaveBeenCalledTimes(2);
  });

  it("responds to c64u-device-safety-updated event", async () => {
    const loadSpy = vi.spyOn(deviceSafetySettings, "loadDeviceSafetyConfig");

    renderSettingsPage();

    const callsBefore = loadSpy.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("c64u-device-safety-updated"));
    });

    expect(loadSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("handles SAF getPersistedUris error path", async () => {
    vi.mocked(FolderPicker.getPersistedUris).mockRejectedValue(new Error("Permission denied"));

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /list persisted uris/i }));

    await waitFor(() => {
      expect(addErrorLog).toHaveBeenCalledWith("SAF persisted URI lookup failed", {
        error: "Permission denied",
      });
    });
  }, 15000);

  it("handles SAF enumeration error path", async () => {
    vi.mocked(FolderPicker.getPersistedUris).mockResolvedValue({
      uris: [{ uri: "content://example" }],
    });
    vi.mocked(FolderPicker.listChildren).mockRejectedValue(new Error("IO error"));

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /list persisted uris/i }));

    await waitFor(() => {
      expect(FolderPicker.getPersistedUris).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /enumerate first root/i }));

    await waitFor(() => {
      expect(addErrorLog).toHaveBeenCalledWith("SAF enumeration failed", {
        error: "IO error",
      });
    });
  }, 15000);

  it("handles non-finite input for discovery timing fields (uses fallback)", async () => {
    renderSettingsPage();

    // Find startup discovery window input and set to non-numeric
    const startupInput =
      screen.queryByLabelText(/startup discovery window/i) ?? screen.queryByTestId("startup-discovery-window-input");
    if (startupInput) {
      fireEvent.change(startupInput, { target: { value: "abc" } });
      fireEvent.blur(startupInput);
      expect(saveStartupDiscoveryWindowMs).toHaveBeenCalled();
    }

    // Background rediscovery interval
    const bgInput =
      screen.queryByLabelText(/background rediscovery interval/i) ??
      screen.queryByTestId("background-rediscovery-input");
    if (bgInput) {
      fireEvent.change(bgInput, { target: { value: "---" } });
      fireEvent.blur(bgInput);
      expect(saveBackgroundRediscoveryIntervalMs).toHaveBeenCalled();
    }
  });

  describe("hostname inline validation", () => {
    it("shows an error message on blur when hostname is invalid", async () => {
      renderSettingsPage();

      const input = screen.getByLabelText(/C64U Hostname \/ IP/i);
      fireEvent.change(input, { target: { value: "-bad-hostname" } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByRole("alert").textContent).toMatch(/valid hostname/i);
      });
    });

    it("clears the error when the user corrects the hostname", async () => {
      renderSettingsPage();

      const input = screen.getByLabelText(/C64U Hostname \/ IP/i);
      fireEvent.change(input, { target: { value: "-bad" } });
      fireEvent.blur(input);

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

      fireEvent.change(input, { target: { value: "c64u.local" } });

      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });

    it("shows an error and does not call updateConfig when Save is clicked with an invalid hostname", async () => {
      renderSettingsPage();

      const input = screen.getByLabelText(/C64U Hostname \/ IP/i);
      fireEvent.change(input, { target: { value: "not valid!" } });
      fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it("does not show an error for an empty hostname (uses application default)", async () => {
      renderSettingsPage();

      const input = screen.getByLabelText(/C64U Hostname \/ IP/i);
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);

      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });

    it("does not show an error for a valid IPv4 address", async () => {
      renderSettingsPage();

      const input = screen.getByLabelText(/C64U Hostname \/ IP/i);
      fireEvent.change(input, { target: { value: "192.168.1.42" } });
      fireEvent.blur(input);

      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
  });
});
