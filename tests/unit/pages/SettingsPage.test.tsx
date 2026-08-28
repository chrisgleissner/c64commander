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
import {
  FocusNavigationProvider,
  useFocusNavigationContext,
  type FocusNavigationContextValue,
} from "@/hooks/useFocusNavigation";
import { reportUserError } from "@/lib/uiErrors";
import { FolderPicker } from "@/lib/native/folderPicker";
import { discoverConnection, getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { clearPasswordForDevice, getPasswordForDevice, setPasswordForDevice } from "@/lib/secureStorage";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, clearLogs, getErrorLogs, getLogs } from "@/lib/logging";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import {
  saveArchiveClientIdOverride,
  saveArchiveHostOverride,
  saveArchiveUserAgentOverride,
  saveDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDebugLoggingEnabled,
  saveDiscoveryProbeTimeoutMs,
  saveStartupDiscoveryWindowMs,
  saveScreenOrientationMode,
  saveHideStatusBar,
  saveHideNavigationBar,
  saveVolumeSliderPreviewIntervalMs,
  saveNotificationDurationMs,
  saveFriendlySidNames,
  savePersistConfigToFlash,
  APP_SETTINGS_KEYS,
} from "@/lib/config/appSettings";
import { applyScreenOrientationMode } from "@/lib/native/screenOrientation";
import * as deviceSafetySettings from "@/lib/config/deviceSafetySettings";
import { exportSettingsJson, importSettingsJson } from "@/lib/config/settingsTransfer";
import { variant } from "@/generated/variant";
import { APP_STYLES, DEFAULT_APP_STYLE_ID } from "@/generated/appStyles";
import {
  loadConfigWriteIntervalMs,
  loadDemoModeEnabled,
  loadStartupDiscoveryWindowMs,
  loadBackgroundRediscoveryIntervalMs,
  loadDiscoveryProbeTimeoutMs,
  loadDiskAutostartMode,
  loadVolumeSliderPreviewIntervalMs,
  loadScreenOrientationMode,
} from "@/lib/config/appSettings";
import { FEATURE_FLAG_DEFINITIONS, type FeatureFlagId } from "@/lib/config/featureFlagsRegistry.generated";

const SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1";
const FTP_PORT_STORAGE_KEY = "c64u_ftp_port";
const TELNET_PORT_STORAGE_KEY = "c64u_telnet_port";
const DISPLAY_PROFILE_OVERRIDE_KEY = "c64u_display_profile_override";
const TEXT_SCALE_KEY = "c64u_text_scale";
const HVSC_UPDATE_CHECK_INTERVAL_DAYS_KEY = "c64u_hvsc_update_check_interval_days";

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
  mockSetStyleId,
  mockRefreshDeviceColorScheme,
  appStyleStateRef,
  mockSetListPreviewLimit,
  mockSwitchSavedDevice,
  mockEvaluateNewDeviceReachability,
  mockStartDeviceDiscovery,
  mockPersistDiscoveredDevice,
  mockGetConnectionSnapshot,
  connectionPayloadRef,
  connectionStateRef,
  deviceDiscoveryStateRef,
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
  mockSetStyleId: vi.fn(),
  mockRefreshDeviceColorScheme: vi.fn(async () => undefined),
  appStyleStateRef: {
    current: {
      storedStyleId: "cool-grey" as string | null,
      isMatchMyDevice: false,
      matchedDeviceStyleId: null as string | null,
      styleId: "cool-grey",
      mode: "light" as "light" | "dark",
      themeClamped: false,
    },
  },
  mockSetListPreviewLimit: vi.fn(),
  mockSwitchSavedDevice: vi.fn(async () => undefined),
  mockEvaluateNewDeviceReachability: vi.fn(async () => ({ status: "reachable" })),
  mockStartDeviceDiscovery: vi.fn(async () => ({
    candidates: [],
    scannedHosts: 0,
    elapsedMs: 0,
    unsupported: false,
  })),
  mockPersistDiscoveredDevice: vi.fn((candidate: { address: string; httpPort: number }) => ({
    deviceId: "discovered-device",
    host: candidate.address,
    httpPort: candidate.httpPort,
    deviceHost: candidate.httpPort === 80 ? candidate.address : `${candidate.address}:${candidate.httpPort}`,
  })),
  mockGetConnectionSnapshot: vi.fn(() => ({ state: "REAL_CONNECTED" })),
  featureFlagsRef: {
    current: {
      hvsc_enabled: true,
      commoserve_enabled: true,
      demo_mode_enabled: false,
      home_telnet_config_actions_enabled: false,
      home_telnet_drive_actions_enabled: false,
      home_telnet_printer_actions_enabled: false,
      home_telnet_power_cycle_enabled: false,
      home_telnet_clear_ram_reboot_enabled: false,
      lighting_studio_enabled: false,
      home_telnet_reu_snapshot_enabled: false,
      keypad_input_enabled: true,
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
  deviceDiscoveryStateRef: {
    current: {
      phase: "idle",
      trigger: null,
      startedAt: null,
      completedAt: null,
      candidates: [],
      scannedHosts: 0,
      elapsedMs: null,
      error: null,
      unsupported: false,
      acknowledged: false,
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

vi.mock("@/hooks/useDeviceDiscovery", () => ({
  useDeviceDiscovery: () => deviceDiscoveryStateRef.current,
}));

vi.mock("@/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery: mockStartDeviceDiscovery,
  persistDiscoveredDevice: mockPersistDiscoveredDevice,
}));

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => ({
    theme: "light",
    setTheme: mockSetTheme,
    resolvedTheme: "light",
  }),
}));
vi.mock("@/components/AppStyleProvider", () => ({
  useAppStyleContext: () => ({
    ...appStyleStateRef.current,
    setStyleId: mockSetStyleId,
    styles: APP_STYLES,
    defaultStyleId: DEFAULT_APP_STYLE_ID,
    refreshDeviceColorScheme: mockRefreshDeviceColorScheme,
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
  useFeatureFlagValue: () => false,
  useFeatureFlags: () => ({
    flags: featureFlagsRef.current,
    resolved: Object.fromEntries(
      FEATURE_FLAG_DEFINITIONS.map((definition) => {
        const id = definition.id as FeatureFlagId;
        const value = featureFlagsRef.current[id] ?? definition.enabled;
        const visible = definition.developer_only ? developerModeEnabledRef.current : definition.visible_to_user;
        const editable = definition.developer_only
          ? developerModeEnabledRef.current
          : definition.visible_to_user && !definition.developer_only;
        return [
          id,
          {
            id,
            value,
            visible,
            editable,
            definition,
          },
        ];
      }),
    ),
    setFlag: mockSetFeatureFlag,
  }),
  useFeatureFlag: (
    key:
      | "hvsc_enabled"
      | "commoserve_enabled"
      | "demo_mode_enabled"
      | "home_telnet_config_actions_enabled"
      | "home_telnet_drive_actions_enabled"
      | "home_telnet_printer_actions_enabled"
      | "home_telnet_power_cycle_enabled"
      | "home_telnet_clear_ram_reboot_enabled"
      | "lighting_studio_enabled"
      | "home_telnet_reu_snapshot_enabled",
  ) => ({
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

/**
 * The page is a set of collapsible chapters, so the controls inside them are not in the DOM
 * until their section is opened. These tests are about what those controls do, not about the
 * collapse — which has its own tests below — so every section is opened first.
 */
const expandAllSections = () => {
  const toggles = screen.queryAllByTestId(/^settings-section-toggle-/);
  toggles.forEach((toggle) => {
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  });
};

/** The controls of one section, without its own header button. */
const sectionBody = (id: string): HTMLElement => {
  const body = document.getElementById(`settings-section-body-${id}`);
  if (!body) throw new Error(`Settings section "${id}" is not open`);
  return body;
};

const withSectionsOpen = <T,>(result: T): T => {
  expandAllSections();
  return result;
};

const renderSettingsPage = () =>
  withSectionsOpen(
    render(
      <RouterProvider
        router={buildRouter(<SettingsPage />)}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />,
    ),
  );

const renderSettingsPageWithDisplayProfileProvider = () =>
  withSectionsOpen(
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
    ),
  );

// Renders the real SettingsPage inside the keypad focus ring (C64U Remote) so the
// Connection card's primary CTAs are exercised through d-pad traversal +
// center-activation, exactly as on the touch-off device.
const FocusContextCapture = ({ target }: { target: { current: FocusNavigationContextValue | null } }) => {
  target.current = useFocusNavigationContext();
  return null;
};

const renderSettingsPageInFocusRing = (focusContext?: { current: FocusNavigationContextValue | null }) =>
  withSectionsOpen(
    render(
      <FocusNavigationProvider profileId="keypad">
        {focusContext ? <FocusContextCapture target={focusContext} /> : null}
        <RouterProvider
          router={buildRouter(<SettingsPage />)}
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        />
      </FocusNavigationProvider>,
    ),
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

vi.mock("@/lib/native/fullScreen", () => ({ applyFullScreenFromSettings: vi.fn() }));

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    getPersistedUris: vi.fn(),
    releasePersistedUris: vi.fn(),
    listChildren: vi.fn(),
  },
}));

vi.mock("@/lib/native/safUtils", () => ({
  redactTreeUri: (value: string) => value,
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  discoverConnection: vi.fn(),
  dismissDemoInterstitial: vi.fn(),
  getConnectionSnapshot: mockGetConnectionSnapshot,
}));

vi.mock("@/lib/connection/addDeviceReachability", () => ({
  evaluateNewDeviceReachability: (...args: unknown[]) => mockEvaluateNewDeviceReachability(...args),
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
  recordDeviceGuard: vi.fn(),
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
  exportSettingsJson: vi.fn(async () => '{"version":2}'),
  importSettingsJson: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/config/appSettings", () => ({
  // SID Radio's minimum-tune-length control reads and writes these; a partial mock that omits them
  // throws at render, and the whole page fails rather than the control.
  DEFAULT_SID_RADIO_MIN_SECONDS: 15,
  loadSidRadioMinSeconds: vi.fn(() => 15),
  saveSidRadioMinSeconds: vi.fn(),
  clampConfigWriteIntervalMs: (value: number) => value,
  clampDiscoveryProbeTimeoutMs: (value: number) => value,
  clampVolumeSliderPreviewIntervalMs: (value: number) => value,
  loadConfigWriteIntervalMs: vi.fn(() => 500),
  clampBackgroundRediscoveryIntervalMs: (value: number) => value,
  clampStartupDiscoveryWindowMs: (value: number) => value,
  loadDemoModeEnabled: vi.fn(() => false),
  loadBackgroundRediscoveryIntervalMs: vi.fn(() => 5000),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 3000),
  loadDebugLoggingEnabled: vi.fn(() => true),
  loadDiskAutostartMode: vi.fn(() => "kernal"),
  loadPersistConfigToFlash: vi.fn(() => false),
  savePersistConfigToFlash: vi.fn(),
  loadVolumeSliderPreviewIntervalMs: vi.fn(() => 200),
  loadSearchInsideDisks: vi.fn(() => false),
  saveSearchInsideDisks: vi.fn(),
  loadFriendlySidNames: vi.fn(() => true),
  saveFriendlySidNames: vi.fn(),
  loadBootMenuAnswerEnabled: vi.fn(() => false),
  saveBootMenuAnswerEnabled: vi.fn(),
  loadBootMenuKey: vi.fn(() => "F7"),
  saveBootMenuKey: vi.fn(),
  loadBootSettleMs: vi.fn(() => 2800),
  saveBootSettleMs: vi.fn(),
  BOOT_MENU_KEYS: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "RETURN", "SPACE"],
  BOOT_SETTLE_MIN_MS: 1000,
  BOOT_SETTLE_MAX_MS: 8000,
  loadStreamVideoPort: vi.fn(() => 11000),
  saveStreamVideoPort: vi.fn(),
  loadStreamAudioPort: vi.fn(() => 11001),
  saveStreamAudioPort: vi.fn(),
  loadStreamNetworkBufferMs: vi.fn(() => 5),
  saveStreamNetworkBufferMs: vi.fn(),
  loadStreamNativeVideoAssembly: vi.fn(() => true),
  saveStreamNativeVideoAssembly: vi.fn(),
  loadStreamInputPriority: vi.fn(() => true),
  saveStreamInputPriority: vi.fn(),
  loadStreamVideoBadges: vi.fn(() => true),
  saveStreamVideoBadges: vi.fn(),
  loadStreamNativeAudio: vi.fn(() => true),
  saveStreamNativeAudio: vi.fn(),
  loadStreamAudioRoute: vi.fn(() => "dynamic"),
  saveStreamAudioRoute: vi.fn(),
  loadArchiveClientIdOverride: vi.fn(() => ""),
  loadArchiveHostOverride: vi.fn(() => ""),
  loadArchiveUserAgentOverride: vi.fn(() => ""),
  saveDemoModeEnabled: vi.fn(),
  saveArchiveHostOverride: vi.fn(),
  saveArchiveClientIdOverride: vi.fn(),
  saveArchiveUserAgentOverride: vi.fn(),
  saveBackgroundRediscoveryIntervalMs: vi.fn(),
  saveDiscoveryProbeTimeoutMs: vi.fn(),
  saveStartupDiscoveryWindowMs: vi.fn(),
  saveConfigWriteIntervalMs: vi.fn(),
  saveDebugLoggingEnabled: vi.fn(),
  loadSidRadioEnabled: vi.fn(() => false),
  loadSidRankingEnabled: vi.fn(() => false),
  saveSidRadioEnabled: vi.fn(),
  saveSidRankingEnabled: vi.fn(),
  loadPlaybackEngine: vi.fn(() => "c64"),
  savePlaybackEngine: vi.fn(),
  // The SID Radio section offers a reSIDfp/SIDLite choice for the on-device
  // engine; without these the whole Settings tree fails to render.
  loadSidEmulationEngine: vi.fn(() => "residfp"),
  saveSidEmulationEngine: vi.fn(),
  loadPlaybackCrossfadeMs: vi.fn(() => 0),
  savePlaybackCrossfadeMs: vi.fn(),
  // The same section offers the fallback SID chip for tunes that name none.
  loadLocalSidModel: vi.fn(() => "8580"),
  saveLocalSidModel: vi.fn(),
  loadLocalSidModelFromDevice: vi.fn(() => true),
  saveLocalSidModelFromDevice: vi.fn(),
  loadLearnedDeviceSidModel: vi.fn(() => null),
  saveLearnedDeviceSidModel: vi.fn(),
  resolveLocalSidModel: vi.fn(() => "8580"),
  LOCAL_SID_MODELS: ["6581", "8580"],
  loadLocalEngineEnabled: vi.fn(() => false),
  saveLocalEngineEnabled: vi.fn(),
  saveDiskAutostartMode: vi.fn(),
  saveVolumeSliderPreviewIntervalMs: vi.fn(),
  DEFAULT_CONFIG_WRITE_INTERVAL_MS: 200,
  loadNotificationVisibility: vi.fn(() => "errors-only"),
  saveNotificationVisibility: vi.fn(),
  loadNotificationDurationMs: vi.fn(() => 4000),
  saveNotificationDurationMs: vi.fn(),
  NOTIFICATION_DURATION_MIN_MS: 2000,
  NOTIFICATION_DURATION_MAX_MS: 8000,
  loadAutoRotationEnabled: vi.fn(() => false),
  saveAutoRotationEnabled: vi.fn(),
  loadScreenOrientationMode: vi.fn(() => "portrait"),
  saveScreenOrientationMode: vi.fn(),
  loadHideStatusBar: vi.fn(() => false),
  saveHideStatusBar: vi.fn(),
  loadHideNavigationBar: vi.fn(() => false),
  saveHideNavigationBar: vi.fn(),
  APP_SETTINGS_KEYS: {
    DEBUG_LOGGING_KEY: "c64u_debug_logging_enabled",
    CONFIG_WRITE_INTERVAL_KEY: "c64u_config_write_min_interval_ms",
    DEMO_MODE_ENABLED_KEY: "c64u_demo_mode_enabled",
    AUTO_DEMO_MODE_KEY: "c64u_demo_mode_enabled",
    STARTUP_DISCOVERY_WINDOW_MS_KEY: "c64u_startup_discovery_window_ms",
    BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY: "c64u_background_rediscovery_interval_ms",
    DISCOVERY_PROBE_TIMEOUT_MS_KEY: "c64u_discovery_probe_timeout_ms",
    DISK_AUTOSTART_MODE_KEY: "c64u_disk_autostart_mode",
    PERSIST_CONFIG_TO_FLASH_KEY: "c64u_persist_config_to_flash",
    VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY: "c64u_volume_slider_preview_interval_ms",
    NOTIFICATION_DURATION_MS_KEY: "c64u_notification_duration_ms",
    AUTO_ROTATION_ENABLED_KEY: "c64u_auto_rotation_enabled",
    SCREEN_ORIENTATION_MODE_KEY: "c64u_screen_orientation_mode",
    ARCHIVE_HOST_OVERRIDE_KEY: "c64u_archive_host_override",
    ARCHIVE_CLIENT_ID_OVERRIDE_KEY: "c64u_archive_client_id_override",
    ARCHIVE_USER_AGENT_OVERRIDE_KEY: "c64u_archive_user_agent_override",
  },
}));

vi.mock("@/lib/native/screenOrientation", () => ({
  applyScreenOrientationMode: vi.fn(async () => undefined),
}));

vi.mock("@/components/ui/slider", () => ({
  // The only <Slider> on SettingsPage is the notification-duration control.
  // Mocked as a native range input so tests can distinguish drag ticks
  // (onValueChange -> onChange) from the drag release (onValueCommit -> onMouseUp),
  // matching the mock convention already used for this component elsewhere.
  Slider: ({ value, onValueChange, onValueCommit, ...props }: any) => (
    <input
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={value?.[0] ?? 0}
      onChange={(event) => onValueChange?.([Number((event.target as HTMLInputElement).value)])}
      onMouseUp={(event) => onValueCommit?.([Number((event.target as HTMLInputElement).value)])}
    />
  ),
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
  mockEvaluateNewDeviceReachability.mockReset();
  mockEvaluateNewDeviceReachability.mockResolvedValue({ status: "reachable" });
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
    SAVED_DEVICES_STORAGE_KEY,
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
  appStyleStateRef.current = {
    storedStyleId: "cool-grey",
    isMatchMyDevice: false,
    matchedDeviceStyleId: null,
    styleId: "cool-grey",
    mode: "light",
    themeClamped: false,
  };
  mockSetStyleId.mockClear();
  mockRefreshDeviceColorScheme.mockClear();
  mockGetConnectionSnapshot.mockReturnValue({ state: "REAL_CONNECTED" });
  deviceDiscoveryStateRef.current = {
    phase: "idle",
    trigger: null,
    startedAt: null,
    completedAt: null,
    candidates: [],
    scannedHosts: 0,
    elapsedMs: null,
    error: null,
    unsupported: false,
  };
  developerModeEnabledRef.current = false;
  featureFlagsRef.current.hvsc_enabled = true;
  featureFlagsRef.current.demo_mode_enabled = false;
  featureFlagsRef.current.home_telnet_config_actions_enabled = false;
  featureFlagsRef.current.home_telnet_drive_actions_enabled = false;
  featureFlagsRef.current.home_telnet_printer_actions_enabled = false;
  featureFlagsRef.current.home_telnet_power_cycle_enabled = false;
  featureFlagsRef.current.home_telnet_clear_ram_reboot_enabled = false;
  featureFlagsRef.current.keypad_input_enabled = true;
  mockSetFeatureFlag.mockReset();
  mockStartDeviceDiscovery.mockReset();
  mockStartDeviceDiscovery.mockResolvedValue({
    candidates: [],
    scannedHosts: 0,
    elapsedMs: 0,
    unsupported: false,
  });
  mockPersistDiscoveredDevice.mockReset();
  mockPersistDiscoveredDevice.mockImplementation((candidate: { address: string; httpPort: number }) => ({
    deviceId: "discovered-device",
    host: candidate.address,
    httpPort: candidate.httpPort,
    deviceHost: candidate.httpPort === 80 ? candidate.address : `${candidate.address}:${candidate.httpPort}`,
  }));
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
  it("saves connection settings without starting a redundant manual discovery after saved-device verification", async () => {
    mockSwitchSavedDevice.mockResolvedValue(undefined);
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u", undefined);
      expect(mockSwitchSavedDevice).toHaveBeenCalledWith("saved-device-1");
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Connection settings saved" }));
    });
    expect(discoverConnection).not.toHaveBeenCalled();
  }, 15000);

  it("blocks the save and calmly suggests the IP when a hostname is unreachable but found on the LAN", async () => {
    mockEvaluateNewDeviceReachability.mockResolvedValue({
      status: "unreachable",
      suggestedAddress: "192.168.1.167",
      suggestedHostname: "c64u",
    });

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-device-reachability-suggestion")).toBeInTheDocument();
    });
    // The unreachable device was NOT committed or connected.
    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(mockSwitchSavedDevice).not.toHaveBeenCalled();

    // Tapping the calm suggestion fills the host field with the working IP.
    fireEvent.click(screen.getByTestId("settings-device-use-suggested-address"));
    expect((screen.getByTestId("settings-device-host") as HTMLInputElement).value).toBe("192.168.1.167");
    expect(screen.queryByTestId("settings-device-reachability-suggestion")).toBeNull();
  }, 15000);

  it("blocks the save with a calm hostname error when the device can't be reached or found", async () => {
    mockEvaluateNewDeviceReachability.mockResolvedValue({
      status: "unreachable",
      suggestedAddress: null,
      suggestedHostname: null,
    });

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/couldn’t reach.*enter its IP address/i)).toBeInTheDocument();
    });
    expect(mockSwitchSavedDevice).not.toHaveBeenCalled();
  }, 15000);

  it("clears a previously-set unreachable-host error once manual refresh recovers the device (BUG-075)", async () => {
    mockEvaluateNewDeviceReachability.mockResolvedValueOnce({
      status: "unreachable",
      suggestedAddress: null,
      suggestedHostname: null,
    });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/couldn’t reach.*enter its IP address/i)).toBeInTheDocument();
    });
    expect(mockSwitchSavedDevice).not.toHaveBeenCalled();

    vi.mocked(discoverConnection).mockResolvedValueOnce(undefined);

    fireEvent.click(screen.getByLabelText("Refresh connection"));

    await waitFor(() => {
      expect(discoverConnection).toHaveBeenCalledWith("manual");
    });
    await waitFor(() => {
      expect(screen.queryByText(/couldn’t reach.*enter its IP address/i)).not.toBeInTheDocument();
    });
  }, 15000);

  it("BUG-075 retains an unreachable-host error when manual refresh finishes offline", async () => {
    mockEvaluateNewDeviceReachability.mockResolvedValueOnce({
      status: "unreachable",
      suggestedAddress: null,
      suggestedHostname: null,
    });
    mockGetConnectionSnapshot.mockReturnValue({ state: "OFFLINE_NO_DEMO" });

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/couldn’t reach.*enter its IP address/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Refresh connection"));

    await waitFor(() => {
      expect(discoverConnection).toHaveBeenCalledWith("manual");
    });
    expect(screen.getByText(/couldn’t reach.*enter its IP address/i)).toBeInTheDocument();
  }, 15000);

  it("gates overlapping manual refresh clicks while discovery is in flight", async () => {
    let resolveRefresh!: () => void;
    vi.mocked(discoverConnection).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    renderSettingsPage();

    const refreshButton = screen.getByLabelText("Refresh connection");
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);

    expect(discoverConnection).toHaveBeenCalledTimes(1);
    expect(refreshButton).toBeDisabled();

    await act(async () => {
      resolveRefresh();
    });

    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });
  });

  it("reports manual refresh failures and re-enables the refresh action", async () => {
    vi.mocked(discoverConnection).mockRejectedValueOnce(new Error("network offline"));

    renderSettingsPage();

    const refreshButton = screen.getByLabelText("Refresh connection");
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CONNECTION_REFRESH",
          title: "Unable to refresh connection",
          description: "network offline",
        }),
      );
    });
    expect(refreshButton).not.toBeDisabled();
  });

  it("starts device discovery from Settings without blocking manual host entry", async () => {
    renderSettingsPage();

    const hostInput = screen.getByLabelText(/c64u hostname \/ ip/i);
    const discoverButton = screen.getByRole("button", { name: /discover devices/i });

    expect(hostInput).not.toBeDisabled();
    fireEvent.click(discoverButton);

    await waitFor(() => {
      expect(mockStartDeviceDiscovery).toHaveBeenCalledWith({
        trigger: "settings",
        includeLanScan: true,
        timeoutMs: 10000,
      });
    });
    expect(hostInput).not.toBeDisabled();
  });

  it("communicates that a Settings discovery scan survives navigation", () => {
    deviceDiscoveryStateRef.current = {
      ...deviceDiscoveryStateRef.current,
      phase: "scanning",
      trigger: "settings",
    };

    renderSettingsPage();

    expect(screen.getByTestId("settings-device-discovery-progress")).toHaveTextContent(
      "You can leave this page; the scan keeps running.",
    );
    expect(screen.getByRole("button", { name: /discover devices/i })).toBeDisabled();
    expect(screen.getByLabelText(/c64u hostname \/ ip/i)).not.toBeDisabled();
  });

  it("selects a discovered device through the saved-device switching path", async () => {
    const candidate = {
      id: "id:38c1ba",
      address: "192.168.1.13",
      host: null,
      httpPort: 80,
      source: ["lan-scan"],
      product: "Ultimate 64 Elite",
      firmwareVersion: "3.14e",
      fpgaVersion: "122",
      coreVersion: "1.4B",
      hostname: "u64",
      uniqueId: "38C1BA",
      requiresPassword: false,
      alreadySavedDeviceId: null,
      confidence: "verified",
      lastSeenAt: "2026-06-21T00:00:00.000Z",
    };
    deviceDiscoveryStateRef.current = {
      ...deviceDiscoveryStateRef.current,
      phase: "complete",
      candidates: [candidate],
      scannedHosts: 254,
      elapsedMs: 500,
    };

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() => {
      expect(mockPersistDiscoveredDevice).toHaveBeenCalledWith(candidate, { select: true, passwordPresent: false });
      expect(mockSwitchSavedDevice).toHaveBeenCalledWith("discovered-device");
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Discovered device selected" }));
    });
  });

  it("explains when automatic discovery is unsupported on this platform", () => {
    deviceDiscoveryStateRef.current = {
      ...deviceDiscoveryStateRef.current,
      phase: "complete",
      candidates: [],
      unsupported: true,
    };

    renderSettingsPage();

    expect(screen.getByTestId("settings-device-discovery-empty")).toHaveTextContent(
      /isn.t available on this platform/i,
    );
  });

  it("locks the Use control while a discovered-device switch is in flight (no double-submit)", async () => {
    const candidate = {
      id: "id:busy",
      address: "192.168.1.30",
      host: null,
      httpPort: 80,
      source: ["lan-scan"],
      product: "Ultimate 64 Elite",
      firmwareVersion: null,
      fpgaVersion: null,
      coreVersion: null,
      hostname: "u64",
      uniqueId: "BUSY01",
      requiresPassword: false,
      alreadySavedDeviceId: null,
      confidence: "verified",
      lastSeenAt: "2026-06-21T00:00:00.000Z",
    };
    deviceDiscoveryStateRef.current = {
      ...deviceDiscoveryStateRef.current,
      phase: "complete",
      candidates: [candidate],
      scannedHosts: 1,
      elapsedMs: 10,
    };
    let resolveSwitch: ((value: undefined) => void) | undefined;
    mockSwitchSavedDevice.mockImplementationOnce(() => new Promise<undefined>((resolve) => (resolveSwitch = resolve)));

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    // While the switch is pending the control shows progress and is disabled, so a second
    // tap cannot race a second persist+switch at the (overload-prone) device.
    await waitFor(() => expect(screen.getByRole("button", { name: "Connecting" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Connecting" }));
    expect(mockSwitchSavedDevice).toHaveBeenCalledTimes(1);

    resolveSwitch?.(undefined);
    await waitFor(() => expect(mockPersistDiscoveredDevice).toHaveBeenCalledTimes(1));
  });

  it("asks for a password before selecting a password-protected discovered device", async () => {
    const candidate = {
      id: "address:192.168.1.14",
      address: "192.168.1.14",
      host: null,
      httpPort: 80,
      source: ["lan-scan"],
      product: "C64 Ultimate",
      firmwareVersion: null,
      fpgaVersion: null,
      coreVersion: null,
      hostname: null,
      uniqueId: null,
      requiresPassword: true,
      alreadySavedDeviceId: null,
      confidence: "verified",
      lastSeenAt: "2026-06-21T00:00:00.000Z",
    };
    deviceDiscoveryStateRef.current = {
      ...deviceDiscoveryStateRef.current,
      phase: "complete",
      candidates: [candidate],
      scannedHosts: 254,
      elapsedMs: 500,
    };

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    expect(screen.getByTestId("settings-device-password-input")).toBeInTheDocument();
    expect(mockPersistDiscoveredDevice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("settings-device-password-confirm"));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the network password");

    fireEvent.change(screen.getByTestId("settings-device-password-input"), { target: { value: "secret" } });
    fireEvent.click(screen.getByTestId("settings-device-password-confirm"));

    await waitFor(() => {
      expect(mockPersistDiscoveredDevice).toHaveBeenCalledWith(candidate, { select: true, passwordPresent: true });
      expect(vi.mocked(setPasswordForDevice)).toHaveBeenCalledWith("discovered-device", "secret");
      expect(mockSwitchSavedDevice).toHaveBeenCalledWith("discovered-device");
    });
  });

  it("does not borrow the current product label for a non-selected saved device row", () => {
    savedDevicesRef.current = {
      ...savedDevicesRef.current,
      selectedDeviceId: "saved-device-1",
      devices: [
        {
          ...savedDevicesRef.current.devices[0],
          id: "saved-device-1",
          name: "Office U64",
          host: "u64",
          type: "U64E",
          lastKnownProduct: "U64E",
        },
        {
          id: "saved-device-2",
          name: "c64u",
          host: "c64u",
          httpPort: 80,
          ftpPort: 21,
          telnetPort: 64,
          lastKnownProduct: null,
          lastKnownHostname: null,
          lastKnownUniqueId: null,
          lastSuccessfulConnectionAt: null,
          lastUsedAt: null,
          hasPassword: false,
        },
      ],
    };
    connectionPayloadRef.current.status.deviceInfo = {
      product: "Ultimate 64 Elite",
    };

    renderSettingsPage();

    const backupRow = screen.getByTestId("settings-device-row-saved-device-2");
    expect(backupRow).toHaveTextContent("Unknown · c64u");
    expect(backupRow).not.toHaveTextContent("U64E · c64u");
  });

  it("offers Friendly SID names in Play and Disk, reflecting the stored preference and writing it back", () => {
    renderSettingsPage();

    const toggle = screen.getByTestId("settings-friendly-sid-names");
    // The mocked loader returns the shipped default of true.
    expect(toggle).toHaveAttribute("data-state", "checked");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(vi.mocked(saveFriendlySidNames)).toHaveBeenCalledWith(false);
  });

  it("persists HTTP, FTP, and Telnet ports when saving connection settings", async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPage();

    fireEvent.change(screen.getByLabelText(/http port/i), { target: { value: "8081" } });
    fireEvent.change(screen.getByLabelText(/ftp port/i), { target: { value: "2121" } });
    fireEvent.change(screen.getByLabelText(/telnet port/i), { target: { value: "2323" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u:8081", undefined);
      expect(localStorage.getItem(FTP_PORT_STORAGE_KEY)).toBe("2121");
      expect(localStorage.getItem(TELNET_PORT_STORAGE_KEY)).toBe("2323");
    });
  });

  it("persists an edited hostname into the saved-devices store (H-01)", async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);
    // Seed the real store with the device the page edits so the persistence
    // path (updateSavedDevice → localStorage) is exercised end to end.
    const store = await import("@/lib/savedDevices/store");
    if (!store.getSavedDeviceById("saved-device-1")) {
      store.addSavedDevice({
        id: "saved-device-1",
        name: "Office U64",
        host: "c64u",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 64,
        lastKnownProduct: "U64",
        lastKnownHostname: "office-u64",
        lastKnownUniqueId: "UID-1",
        hasPassword: false,
      });
    }

    renderSettingsPage();

    fireEvent.change(screen.getByLabelText(/c64u hostname \/ ip/i), { target: { value: "edited-host.local" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("edited-host.local", undefined);
    });

    const persisted = JSON.parse(localStorage.getItem(SAVED_DEVICES_STORAGE_KEY) ?? "{}");
    const savedDevice = (persisted.devices as Array<{ id: string; host: string }>).find(
      (device) => device.id === "saved-device-1",
    );
    expect(savedDevice?.host).toBe("edited-host.local");
  });

  it("persists the saved-device password flag before switching devices", async () => {
    renderSettingsPage();

    fireEvent.change(screen.getByLabelText(/password|network password/i), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(vi.mocked(setPasswordForDevice)).toHaveBeenCalledWith("saved-device-1", "new-password");
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u", "new-password");
    });
  });

  it("never loads the real saved password into the editable field (HARD9-004)", async () => {
    savedDevicesRef.current = {
      ...savedDevicesRef.current,
      devices: [{ ...savedDevicesRef.current.devices[0], hasPassword: true }],
    };
    vi.mocked(getPasswordForDevice).mockResolvedValue("super-secret");

    renderSettingsPage();

    // The field shows a locked placeholder, never the real secret, and does not
    // fetch it from secure storage just to render.
    const lockedField = screen.getByLabelText(/network password/i) as HTMLInputElement;
    expect(lockedField).toBeDisabled();
    expect(lockedField.value).not.toBe("super-secret");
    expect(vi.mocked(getPasswordForDevice)).not.toHaveBeenCalled();

    // Clicking Change reveals an empty, editable field — not the real password.
    fireEvent.click(screen.getByRole("button", { name: /^change$/i }));
    const editableField = screen.getByLabelText(/network password/i) as HTMLInputElement;
    expect(editableField).not.toBeDisabled();
    expect(editableField.value).toBe("");
  });

  it("does not persist a stray keystroke and rejects a wrong replacement password without saving it (HARD9-004)", async () => {
    savedDevicesRef.current = {
      ...savedDevicesRef.current,
      devices: [{ ...savedDevicesRef.current.devices[0], hasPassword: true }],
    };
    mockEvaluateNewDeviceReachability.mockResolvedValue({ status: "needs-password" });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /^change$/i }));
    fireEvent.change(screen.getByLabelText(/network password/i), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/wrong password for this device/i)).toBeInTheDocument();
    });
    expect(vi.mocked(setPasswordForDevice)).not.toHaveBeenCalled();
    expect(vi.mocked(clearPasswordForDevice)).not.toHaveBeenCalled();
    expect(mockSwitchSavedDevice).not.toHaveBeenCalled();
  });

  it("saving without touching an already-saved password keeps it unchanged and reuses it for verification", async () => {
    savedDevicesRef.current = {
      ...savedDevicesRef.current,
      devices: [{ ...savedDevicesRef.current.devices[0], hasPassword: true }],
    };
    vi.mocked(getPasswordForDevice).mockResolvedValue("existing-secret");

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("c64u", "existing-secret");
      expect(mockSwitchSavedDevice).toHaveBeenCalledWith("saved-device-1");
    });
    expect(vi.mocked(setPasswordForDevice)).not.toHaveBeenCalled();
    expect(vi.mocked(clearPasswordForDevice)).not.toHaveBeenCalled();
  });

  it("reports a wrong-password saved-device switch as an auth failure, not offline (HARD9-028)", async () => {
    mockSwitchSavedDevice.mockResolvedValueOnce({
      ok: false,
      deviceInfo: null,
      error: "HTTP 403: Forbidden",
      authRequired: true,
    });

    renderSettingsPage();
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CONNECTION_SAVE",
          title: "Unable to save connection",
          description: "The device rejected the password. Check the password and try again.",
        }),
      );
    });
  });

  it("removes badge-label authoring and persists a host-derived inferred name when the user clears the field", async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPage();

    expect(screen.queryByLabelText(/badge label/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/device name/i), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/c64u hostname \/ ip/i), { target: { value: "ultimate.local" } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("ultimate.local", undefined);
    });

    const persisted = JSON.parse(localStorage.getItem(SAVED_DEVICES_STORAGE_KEY) ?? "{}");
    expect(Array.isArray(persisted.devices)).toBe(true);
  });

  it("keeps a legacy custom device name editable when the host changes", () => {
    renderSettingsPage();

    const deviceNameInput = screen.getByLabelText(/device name/i);
    const hostInput = screen.getByLabelText(/c64u hostname \/ ip/i);

    expect(deviceNameInput).toHaveValue("Office U64");

    fireEvent.change(hostInput, { target: { value: "ultimate.local" } });

    expect(deviceNameInput).toHaveValue("Office U64");
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
      SAVED_DEVICES_STORAGE_KEY,
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
    const beforeDelete = localStorage.getItem(SAVED_DEVICES_STORAGE_KEY);

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
    expect(localStorage.getItem(SAVED_DEVICES_STORAGE_KEY)).toBe(beforeDelete);
  });

  it("uses icon-only saved-device actions and shows the HVSC override panel", () => {
    renderSettingsPage();

    expect(screen.getByTestId("settings-add-device")).toHaveAccessibleName("Add device");
    expect(screen.getByTestId("settings-delete-device")).toHaveAccessibleName("Delete device");
    expect(screen.getByRole("heading", { name: "HVSC" })).toBeInTheDocument();
    expect(screen.getByTestId("hvsc-base-url")).toBeInTheDocument();
    expect(screen.getByTestId("hvsc-update-check-interval")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stable Features" })).toBeInTheDocument();
    expect(screen.getByText(/hvsc downloads/i)).toBeInTheDocument();
  });

  it("clamps the HVSC automatic update interval to the minimum cadence", () => {
    renderSettingsPage();

    const input = screen.getByTestId("hvsc-update-check-interval");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);

    expect((input as HTMLInputElement).value).toBe("1");
    expect(localStorage.getItem(HVSC_UPDATE_CHECK_INTERVAL_DAYS_KEY)).toBe("1");
  });

  it("renders stable feature rows before experimental ones", () => {
    developerModeEnabledRef.current = true;

    renderSettingsPage();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent ?? "");
    expect(headings.indexOf("Stable Features")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("Experimental Features")).toBeGreaterThan(headings.indexOf("Stable Features"));

    const stableSection = screen.getByTestId("settings-feature-group-stable");
    const experimentalSection = screen.getByTestId("settings-feature-group-experimental");
    expect(within(stableSection).getByTestId("feature-flag-hvsc_enabled")).toBeInTheDocument();
    expect(within(stableSection).getByTestId("feature-flag-commoserve_enabled")).toBeInTheDocument();
    expect(
      within(experimentalSection).getByTestId("feature-flag-home_telnet_config_actions_enabled"),
    ).toBeInTheDocument();
    expect(within(experimentalSection).getByTestId("feature-flag-lighting_studio_enabled")).toBeInTheDocument();
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

    const connectionSection = screen.getByRole("heading", { name: "Connection" }).closest(".rounded-panel");
    const configHeading = screen.queryByRole("heading", { name: "Config" });
    const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-panel");

    expect(connectionSection).toBeTruthy();
    expect(configHeading).toBeNull();
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

    expect(screen.getAllByLabelText(/startup discovery window/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/background rediscovery interval/i)).toHaveLength(1);
    expect(document.querySelectorAll("#startup-discovery-window")).toHaveLength(1);
    expect(document.querySelectorAll("#background-rediscovery-interval")).toHaveLength(1);
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

  it("reports a foreground connection error when saved-device verification finishes offline", async () => {
    mockSwitchSavedDevice.mockResolvedValueOnce({
      ok: false,
      deviceInfo: null,
      error: "Host unreachable",
      resolvedAddress: null,
    });

    renderSettingsPage();

    fireEvent.change(screen.getByLabelText(/c64u hostname \/ ip/i), { target: { value: "  nosuchhost-c64u:8080  " } });
    fireEvent.click(screen.getByRole("button", { name: /save & connect/i }));

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledWith("nosuchhost-c64u", undefined);
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CONNECTION_SAVE",
          title: "Unable to save connection",
          description: "Host unreachable",
          deviceHost: "nosuchhost-c64u",
        }),
      );
    });
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Connection settings saved" }));
  });

  it("hides the automatic demo-mode setting when the feature flag is disabled", () => {
    renderSettingsPage();

    expect(screen.queryByRole("checkbox", { name: /automatic demo mode/i })).toBeNull();
  });

  it("persists automatic demo mode and debug logging toggles", () => {
    featureFlagsRef.current.demo_mode_enabled = true;
    vi.mocked(loadDemoModeEnabled).mockReturnValue(true);

    renderSettingsPage();

    fireEvent.click(screen.getByRole("checkbox", { name: /automatic demo mode/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /enable debug logging/i }));

    expect(saveDemoModeEnabled).toHaveBeenCalledWith(false);
    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(false);
  });

  it("renders the Automatic Demo Mode control exactly once, not duplicated across cards (HARD9-090)", () => {
    // Regression: the Connection card and a separate "Config" card both
    // rendered a checkbox with the same id="demo-mode-enabled". Per the
    // HTML spec, <label for> resolution always finds the FIRST element
    // with a given id, so the second card's label silently activated the
    // first card's checkbox instead of its own - a duplicate DOM id that
    // getByRole's accessible-name matching does not surface as ambiguous.
    featureFlagsRef.current.demo_mode_enabled = true;
    vi.mocked(loadDemoModeEnabled).mockReturnValue(true);

    const { container } = renderSettingsPage();

    expect(container.querySelectorAll("#demo-mode-enabled")).toHaveLength(1);
    expect(screen.getAllByText(/automatic demo mode/i)).toHaveLength(1);
  });

  it("disabling the demo-mode feature flag clears the persisted demo-mode setting", async () => {
    featureFlagsRef.current.demo_mode_enabled = true;
    vi.mocked(loadDemoModeEnabled).mockReturnValue(true);

    renderSettingsPage();

    fireEvent.click(screen.getByTestId("feature-flag-demo_mode_enabled"));

    await waitFor(() => {
      expect(mockSetFeatureFlag).toHaveBeenCalledWith("demo_mode_enabled", false);
    });
    expect(saveDemoModeEnabled).toHaveBeenCalledWith(false);
    expect(discoverConnection).toHaveBeenCalledWith("settings");
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

  describe("collapsible sections", () => {
    it("opens on Connection and leaves the rest closed, so the page can be read at a glance", () => {
      render(
        <RouterProvider
          router={buildRouter(<SettingsPage />)}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        />,
      );

      expect(screen.getByTestId("settings-section-connection")).toHaveAttribute("data-open", "true");
      for (const id of ["appearance", "diagnostics", "play-and-disk", "device-safety", "notifications", "about"]) {
        expect(screen.getByTestId(`settings-section-${id}`)).toHaveAttribute("data-open", "false");
      }
    });

    it("says what each closed section decides, once card descriptions are turned on", () => {
      // Descriptions are off by default: on the smallest supported screen they cost about half the
      // height of every closed card, and the titles already name what each card is. When a reader
      // does turn them on, each one still has to describe its own section.
      localStorage.setItem("c64u_show_section_descriptions", "1");
      render(
        <RouterProvider
          router={buildRouter(<SettingsPage />)}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        />,
      );

      expect(screen.getByTestId("settings-section-appearance")).toHaveTextContent(/theme, text size/i);
      expect(screen.getByTestId("settings-section-play-and-disk")).toHaveTextContent(/live view streaming/i);
      expect(screen.getByTestId("settings-section-device-safety")).toHaveTextContent(/network timing/i);
    });

    // The summaries are the only wayfinding on this page: every section but Connection
    // starts closed, so a reader looking for a control picks a section by its summary and
    // opens it. A summary that names a control the section does not hold sends them to the
    // wrong place and gives them no way to tell.
    //
    // About's summary used to end in "settings transfer" while Export settings and Import
    // settings were, and still are, in Diagnostics. This asserts the general rule rather
    // than that one wording: whichever section's summary offers settings transfer has to be
    // the section the buttons are in.
    it("offers settings transfer from the section that actually holds it", () => {
      renderSettingsPage();

      // The section wrapper only. Its own toggle carries the summary text as well, and
      // matching both would count one section twice.
      const sections = screen
        .queryAllByTestId(/^settings-section-(?!toggle-)[a-z-]+$/)
        .filter((section) => /settings transfer/i.test(section.textContent ?? ""));

      expect(sections).toHaveLength(1);
      const [offering] = sections;
      expect(within(offering).getByRole("button", { name: /export settings/i })).toBeInTheDocument();
      expect(within(offering).getByRole("button", { name: /import settings/i })).toBeInTheDocument();
    });

    it("keeps a section open across visits once it has been opened", () => {
      const first = render(
        <RouterProvider
          router={buildRouter(<SettingsPage />)}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        />,
      );
      fireEvent.click(screen.getByTestId("settings-section-toggle-notifications"));
      expect(screen.getByTestId("settings-section-notifications")).toHaveAttribute("data-open", "true");
      first.unmount();

      render(
        <RouterProvider
          router={buildRouter(<SettingsPage />)}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        />,
      );
      expect(screen.getByTestId("settings-section-notifications")).toHaveAttribute("data-open", "true");
    });

    it("holds every control it always did — they are only behind their section", () => {
      render(
        <RouterProvider
          router={buildRouter(<SettingsPage />)}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        />,
      );
      expect(screen.queryByTestId("settings-show-autofire")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("settings-section-toggle-play-and-disk"));

      expect(screen.getByTestId("settings-show-autofire")).toBeInTheDocument();
      // The Game Mode block moved with the rest of Remote Input, not away from it.
      expect(screen.getByTestId("settings-game-mode-on-launch")).toBeInTheDocument();
      expect(screen.getByTestId("settings-game-mode-section")).toBeInTheDocument();
    });
  });

  it("changes theme when selecting a new option", () => {
    renderSettingsPage();

    // Scoped to the Theme group: "Dark only" style badges (e.g. Amber Glow, Vault Black) also
    // match a loose /dark/i name query once the Style picker's rows are in the same section.
    fireEvent.click(within(screen.getByRole("group", { name: "Theme" })).getByRole("button", { name: /dark/i }));

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("changes theme when selecting the auto option", () => {
    renderSettingsPage();

    fireEvent.click(within(sectionBody("appearance")).getAllByRole("button")[0]);

    expect(mockSetTheme).toHaveBeenCalledWith("system");
  });

  it("shows appearance theme options in auto light dark order", () => {
    renderSettingsPage();

    const buttons = within(sectionBody("appearance")).getAllByRole("button");
    const themeLabels = buttons.slice(0, 3).map((button) => button.textContent?.trim() ?? "");
    expect(themeLabels).toEqual(["Auto", "Light", "Dark"]);
  });

  describe("appearance style picker", () => {
    it("renders a row for every generated style plus Match my device", () => {
      renderSettingsPage();

      for (const style of APP_STYLES) {
        expect(screen.getByTestId(`settings-app-style-${style.id}`)).toBeInTheDocument();
      }
      expect(screen.getByTestId("settings-app-style-match-my-device")).toBeInTheDocument();
    });

    it("marks dark-only styles and leaves both-mode styles unmarked", () => {
      renderSettingsPage();

      for (const style of APP_STYLES) {
        const row = screen.getByTestId(`settings-app-style-${style.id}`);
        if (style.modes.length === 1) {
          expect(within(row).getByText("Dark only")).toBeInTheDocument();
        } else {
          expect(within(row).queryByText("Dark only")).not.toBeInTheDocument();
        }
      }
    });

    it("highlights the currently selected style", () => {
      appStyleStateRef.current.storedStyleId = "ocean-teal";
      appStyleStateRef.current.styleId = "ocean-teal";
      renderSettingsPage();

      expect(screen.getByTestId("settings-app-style-ocean-teal")).toHaveClass("bg-primary");
      expect(screen.getByTestId("settings-app-style-cool-grey")).not.toHaveClass("bg-primary");
    });

    it("highlights the resolved default style when nothing has been stored yet", () => {
      // Fresh install: no stored id, so the compiled default is what is on screen and the row
      // for it has to read as selected rather than leaving the whole group looking unset.
      appStyleStateRef.current.storedStyleId = null;
      appStyleStateRef.current.styleId = "cool-grey";
      renderSettingsPage();

      expect(screen.getByTestId("settings-app-style-cool-grey")).toHaveClass("bg-primary");
      expect(screen.getByTestId("settings-app-style-ocean-teal")).not.toHaveClass("bg-primary");
    });

    it("calls setStyleId when a style row is clicked", () => {
      renderSettingsPage();

      fireEvent.click(screen.getByTestId("settings-app-style-vault-black"));

      expect(mockSetStyleId).toHaveBeenCalledWith("vault-black");
    });

    it("calls setStyleId with the sentinel when Match my device is clicked", () => {
      renderSettingsPage();

      fireEvent.click(screen.getByTestId("settings-app-style-match-my-device"));

      expect(mockSetStyleId).toHaveBeenCalledWith("match-my-device");
    });

    it("disables the Theme row and explains why when the selected style is dark-only", () => {
      appStyleStateRef.current.storedStyleId = "vault-black";
      appStyleStateRef.current.styleId = "vault-black";
      appStyleStateRef.current.mode = "dark";
      appStyleStateRef.current.themeClamped = true;
      renderSettingsPage();

      const themeGroup = screen.getByRole("group", { name: "Theme" });
      for (const button of within(themeGroup).getAllByRole("button")) {
        expect(button).toBeDisabled();
      }
      expect(screen.getByTestId("settings-theme-clamped-note")).toHaveTextContent(
        "Vault Black only renders dark, so Theme has no effect while it's selected.",
      );
    });

    it("does not disable the Theme row for a style that follows the theme normally", () => {
      renderSettingsPage();

      const themeGroup = screen.getByRole("group", { name: "Theme" });
      for (const button of within(themeGroup).getAllByRole("button")) {
        expect(button).not.toBeDisabled();
      }
      expect(screen.queryByTestId("settings-theme-clamped-note")).not.toBeInTheDocument();
    });

    it("reports the matched style when Match my device has resolved one", () => {
      appStyleStateRef.current.storedStyleId = "match-my-device";
      appStyleStateRef.current.isMatchMyDevice = true;
      appStyleStateRef.current.matchedDeviceStyleId = "vault-black";
      appStyleStateRef.current.styleId = "vault-black";
      renderSettingsPage();

      expect(screen.getByTestId("settings-app-style-match-status")).toHaveTextContent(
        "Matches the device's Color Scheme right now: Vault Black.",
      );
    });

    it("falls back to the default style visibly when the device has not been probed", () => {
      appStyleStateRef.current.storedStyleId = "match-my-device";
      appStyleStateRef.current.isMatchMyDevice = true;
      appStyleStateRef.current.matchedDeviceStyleId = null;
      appStyleStateRef.current.styleId = DEFAULT_APP_STYLE_ID;
      renderSettingsPage();

      expect(screen.getByTestId("settings-app-style-match-status")).toHaveTextContent(
        /The device hasn't reported a Color Scheme yet — using Cool Grey until it connects or you refresh the connection\./,
      );
    });

    it("calls refreshDeviceColorScheme alongside a manual connection refresh that lands connected", async () => {
      vi.mocked(discoverConnection).mockResolvedValueOnce(undefined);
      mockGetConnectionSnapshot.mockReturnValue({ state: "REAL_CONNECTED" });
      renderSettingsPage();

      fireEvent.click(screen.getByLabelText("Refresh connection"));

      await waitFor(() => {
        expect(discoverConnection).toHaveBeenCalledWith("manual");
      });
      await waitFor(() => {
        expect(mockRefreshDeviceColorScheme).toHaveBeenCalled();
      });
    });

    it("does not call refreshDeviceColorScheme when a manual refresh finishes offline", async () => {
      vi.mocked(discoverConnection).mockResolvedValueOnce(undefined);
      mockGetConnectionSnapshot.mockReturnValue({ state: "OFFLINE_NO_DEMO" });
      renderSettingsPage();

      fireEvent.click(screen.getByLabelText("Refresh connection"));

      await waitFor(() => {
        expect(discoverConnection).toHaveBeenCalledWith("manual");
      });
      expect(mockRefreshDeviceColorScheme).not.toHaveBeenCalled();
    });
  });

  it("persists the chosen text size and applies it to the document", () => {
    renderSettingsPage();

    const card = screen.getByTestId("settings-text-size");
    expect(within(card).getByTestId("settings-text-size-default")).toHaveClass("bg-primary");

    fireEvent.click(within(card).getByTestId("settings-text-size-larger"));

    // Written, so the size survives a restart.
    expect(localStorage.getItem(TEXT_SCALE_KEY)).toBe("larger");
    // Applied, so it takes effect on the spot rather than at the next launch.
    expect(document.documentElement.style.getPropertyValue("--text-scale")).toBe("1.3");
    // Reflected back, so the highlighted option is the one actually in force.
    expect(within(card).getByTestId("settings-text-size-larger")).toHaveClass("bg-primary");
    expect(within(card).getByTestId("settings-text-size-default")).not.toHaveClass("bg-primary");
  });

  it("persists display profile overrides and reports the auto compact resolution", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
      writable: true,
    });

    renderSettingsPageWithDisplayProfileProvider();
    // Open Appearance only if it is not already open. Every profile now leaves it to the reader
    // how many cards are open, so the shared setup may already have opened this one; clicking
    // regardless would close it and hide the line this test is about.
    if (screen.getByTestId("settings-section-appearance").getAttribute("data-open") !== "true") {
      fireEvent.click(screen.getByTestId("settings-section-toggle-appearance"));
    }

    expect(screen.getByText(/Auto currently resolves to Small display\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Large display" }));

    expect(localStorage.getItem(DISPLAY_PROFILE_OVERRIDE_KEY)).toBe("expanded");
    expect(document.documentElement.dataset.displayProfile).toBe("expanded");
  });

  it("applies theme selection on touch pointer up", () => {
    renderSettingsPage();

    fireEvent.pointerUp(screen.getByRole("button", { name: "Dark" }), { pointerType: "touch" });

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("renders the screen orientation mode card and persists the selected lock", () => {
    vi.mocked(loadScreenOrientationMode).mockReturnValue("portrait");
    renderSettingsPage();

    expect(screen.queryByRole("checkbox", { name: /adapt layout on screen rotation/i })).toBeNull();
    const card = screen.getByTestId("settings-screen-orientation-mode");
    expect(within(card).getByRole("button", { name: "Portrait" })).toHaveClass("bg-primary");
    expect(within(card).getByRole("button", { name: "Landscape" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Auto" })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Landscape" }));
    expect(saveScreenOrientationMode).toHaveBeenCalledWith("landscape");
  });

  it("toggles the full-screen system-bar settings (Android)", () => {
    renderSettingsPage();
    const section = screen.getByTestId("settings-full-screen");
    fireEvent.click(within(section).getByTestId("settings-hide-status-bar"));
    expect(saveHideStatusBar).toHaveBeenCalledWith(true);
    fireEvent.click(within(section).getByTestId("settings-hide-navigation-bar"));
    expect(saveHideNavigationBar).toHaveBeenCalledWith(true);
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

    const aboutCard = screen.getByTestId("settings-about-build-info");
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

    const aboutCard = screen.getByTestId("settings-about-build-info");
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

  it("reports settings export failures", async () => {
    const createObjectURL = vi.fn(() => {
      throw new Error("export blocked");
    });
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /export settings/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "SETTINGS_EXPORT",
          description: "export blocked",
        }),
      );
    });
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

  it("hides the HVSC and Online Archive sections when those features are disabled (C64U Remote pruning)", () => {
    featureFlagsRef.current.hvsc_enabled = false;
    featureFlagsRef.current.commoserve_enabled = false;
    renderSettingsPage();

    expect(screen.queryByTestId("hvsc-base-url")).toBeNull();
    expect(screen.queryByTestId("settings-online-archive")).toBeNull();
    expect(screen.queryByTestId("open-online-archive")).toBeNull();
    expect(screen.queryByText("HVSC base URL override")).toBeNull();
  });

  it("shows the HVSC and Online Archive sections when those features are enabled", () => {
    featureFlagsRef.current.hvsc_enabled = true;
    featureFlagsRef.current.commoserve_enabled = true;
    renderSettingsPage();

    expect(screen.getByTestId("hvsc-base-url")).toBeInTheDocument();
    expect(screen.getByTestId("settings-online-archive")).toBeInTheDocument();
  });

  it("requires confirmation when switching into relaxed safety mode", async () => {
    const saveSpy = vi.spyOn(deviceSafetySettings, "saveDeviceSafetyMode");

    renderSettingsPage();

    const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-panel");
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

  it("renders AUTO first with the resolved preset line", () => {
    const loadSpy = vi.spyOn(deviceSafetySettings, "loadDeviceSafetyConfig");
    const contextSpy = vi.spyOn(deviceSafetySettings, "getActiveAutoResolutionContext");
    const currentConfig = deviceSafetySettings.loadDeviceSafetyConfig();

    try {
      loadSpy.mockReturnValue({
        ...currentConfig,
        mode: "AUTO",
        resolution: {
          storedMode: "AUTO",
          effectiveMode: "BALANCED",
          resolvedPreset: "BALANCED",
          isProvisional: false,
          reason: "auto-u64-family",
        },
      });
      contextSpy.mockReturnValue({
        activeProduct: "U64E",
        activeDeviceId: "saved-device-1",
      });

      renderSettingsPage();

      const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-panel");
      expect(deviceSafetySection).toBeTruthy();

      const options = within(deviceSafetySection as HTMLElement).getAllByRole("option");
      expect(options[0]).toHaveValue("AUTO");
      expect(options[0]).toHaveTextContent(/recommended/i);
      expect(
        within(deviceSafetySection as HTMLElement).getByText(
          "Effective preset: Balanced - resolved from active device (U64 Elite, verified).",
        ),
      ).toBeVisible();
    } finally {
      loadSpy.mockRestore();
      contextSpy.mockRestore();
    }
  });

  it("feeds persisted safety mode changes into the runtime interaction scheduler", async () => {
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;

    try {
      renderSettingsPage();

      const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-panel");
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

    await waitFor(() => {
      expect(exportSettingsJson).toHaveBeenCalled();
      expect(createObjectURL).toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith({ title: "Settings export ready" });
    });
    createElementSpy.mockRestore();
  });

  it("HARD19-035: names the settings export after the variant basename", async () => {
    const createObjectURL = vi.fn(() => "blob:settings");
    const revokeObjectURL = vi.fn();
    let exportedAnchor: HTMLAnchorElement | null = null;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        (element as HTMLAnchorElement).click = vi.fn();
        exportedAnchor = element as HTMLAnchorElement;
      }
      return element;
    });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });

    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /export settings/i }));

    await waitFor(() => expect(exportSettingsJson).toHaveBeenCalled());
    // Filename must derive from the variant basename (like diagnostics/trace
    // exports), never the hardcoded "c64commander-settings.json".
    expect(exportedAnchor).not.toBeNull();
    expect(exportedAnchor!.download).toBe(`${variant.exportedFileBasename}-settings.json`);
    createElementSpy.mockRestore();
  });

  it("imports settings and refreshes local state", async () => {
    vi.mocked(importSettingsJson).mockResolvedValue({ ok: true });
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

  it("HARD19-035 (D10): surfaces the cross-variant import warning as a destructive toast", async () => {
    vi.mocked(importSettingsJson).mockResolvedValue({
      ok: true,
      warning: "These settings were exported from a different app variant (c64u-remote).",
    });
    const file = new File(['{"version":2}'], "settings.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: vi.fn(async () => '{"version":2}') });

    renderSettingsPage();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Settings imported",
          description: expect.stringContaining("different app variant"),
          variant: "destructive",
        }),
      );
    });
  });

  it("HARD19-030: applies and reflects an imported screen orientation without a relaunch", async () => {
    vi.mocked(importSettingsJson).mockResolvedValue({ ok: true });
    const file = new File(['{"version":1}'], "settings.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: vi.fn(async () => '{"version":1}') });

    renderSettingsPage();

    // The imported file's persisted orientation is landscape (UI default is portrait).
    vi.mocked(loadScreenOrientationMode).mockReturnValue("landscape");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: buildFileList(file) } });

    await waitFor(() => {
      // Device is rotated immediately, not deferred to the next app launch.
      expect(applyScreenOrientationMode).toHaveBeenCalledWith("landscape");
    });
    // The Settings selector reflects the imported value (Landscape now active).
    const orientation = screen.getByTestId("settings-screen-orientation-mode");
    const landscapeButton = within(orientation).getByRole("button", { name: "Landscape" });
    expect(landscapeButton.className).toContain("bg-primary");
  });

  it("reports import validation errors", async () => {
    vi.mocked(importSettingsJson).mockResolvedValue({
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

    const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-panel");
    expect(deviceSafetySection).toBeTruthy();
    const trigger = within(deviceSafetySection as HTMLElement).getByRole("combobox");
    fireEvent.change(trigger, { target: { value: "TROUBLESHOOTING" } });

    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
  });

  it("shows the actual Config write spacing default in Device Safety advanced controls", () => {
    renderSettingsPage();

    const deviceSafetySection = screen.getByRole("heading", { name: "Device Safety" }).closest(".rounded-panel");

    expect(deviceSafetySection).toBeTruthy();
    const configWriteInput = within(deviceSafetySection as HTMLElement).getByLabelText("Config write spacing (ms)");
    expect(configWriteInput.closest(".space-y-2")).toHaveTextContent(
      "Minimum delay between consecutive config write calls. Default 200 ms.",
    );
  });

  it("responds to c64u-app-settings-updated events for all tracked keys", async () => {
    renderSettingsPage();

    // Reset call counts after initial render
    vi.mocked(loadConfigWriteIntervalMs).mockClear();
    vi.mocked(loadDemoModeEnabled).mockClear();
    vi.mocked(loadStartupDiscoveryWindowMs).mockClear();
    vi.mocked(loadBackgroundRediscoveryIntervalMs).mockClear();
    vi.mocked(loadDiscoveryProbeTimeoutMs).mockClear();
    vi.mocked(loadDiskAutostartMode).mockClear();
    vi.mocked(loadVolumeSliderPreviewIntervalMs).mockClear();

    const keys = [
      // debug_logging uses a direct state setter (no load function)
      APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY,
      APP_SETTINGS_KEYS.CONFIG_WRITE_INTERVAL_KEY,
      APP_SETTINGS_KEYS.DEMO_MODE_ENABLED_KEY,
      APP_SETTINGS_KEYS.STARTUP_DISCOVERY_WINDOW_MS_KEY,
      APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY,
      APP_SETTINGS_KEYS.DISCOVERY_PROBE_TIMEOUT_MS_KEY,
      APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY,
      APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY,
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

    expect(vi.mocked(loadConfigWriteIntervalMs)).toHaveBeenCalled();
    expect(vi.mocked(loadDemoModeEnabled)).toHaveBeenCalled();
    expect(vi.mocked(loadStartupDiscoveryWindowMs)).toHaveBeenCalled();
    expect(vi.mocked(loadBackgroundRediscoveryIntervalMs)).toHaveBeenCalled();
    expect(vi.mocked(loadDiscoveryProbeTimeoutMs)).toHaveBeenCalled();
    expect(vi.mocked(loadDiskAutostartMode)).toHaveBeenCalled();
    expect(vi.mocked(loadVolumeSliderPreviewIntervalMs)).toHaveBeenCalled();
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
        detail: { key: APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY },
      }),
    );

    const input = screen.getByLabelText(/slider preview interval/i);
    fireEvent.change(input, { target: { value: "345" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(saveVolumeSliderPreviewIntervalMs).toHaveBeenCalledWith(345);
    expect(saveVolumeSliderPreviewIntervalMs).toHaveBeenCalledTimes(2);
  });

  // Off is the default and it is the state in which nothing the app changes survives a power
  // cycle, so the row has to explain both states without being switched on. The recovery route
  // only matters once the setting is on, so it is asserted in the on state.
  it("explains both states of the keep-settings row, and only warns once it is on", async () => {
    renderSettingsPage();

    const section = screen.getByTestId("settings-section-device-safety");
    expect(section).toHaveTextContent(/keep device settings after a restart/i);
    expect(section).toHaveTextContent(/off: a setting you change here/i);
    expect(section).toHaveTextContent(/on: the app also writes/i);
    expect(screen.queryByTestId("settings-persist-config-to-flash-warning")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("settings-persist-config-to-flash"));
    });

    expect(savePersistConfigToFlash).toHaveBeenCalledWith(true);
    const warning = screen.getByTestId("settings-persist-config-to-flash-warning");
    expect(warning).toHaveTextContent(/RESTORE/);
    expect(warning).toHaveTextContent(/nothing is erased/i);
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

describe("SettingsPage notification duration slider", () => {
  it("does not persist on every drag tick, only when the drag is released", () => {
    renderSettingsPage();

    // The page now has more than one slider (e.g. the autofire rate), so scope
    // to the notification-duration slider via its own labelled row.
    const durationRow = screen.getByText(/^Duration: /).closest("div") as HTMLElement;
    const slider = within(durationRow).getByRole("slider");

    fireEvent.change(slider, { target: { value: "4500" } });
    fireEvent.change(slider, { target: { value: "5000" } });
    fireEvent.change(slider, { target: { value: "5500" } });

    // Local UI (the "Duration: Ns" label) tracks every drag tick immediately...
    expect(screen.getByText(/Duration: 5\.5s/)).toBeInTheDocument();
    // ...but nothing is written to device/localStorage mid-drag.
    expect(saveNotificationDurationMs).not.toHaveBeenCalled();

    fireEvent.mouseUp(slider);

    expect(saveNotificationDurationMs).toHaveBeenCalledTimes(1);
    expect(saveNotificationDurationMs).toHaveBeenCalledWith(5500);
  });
});

describe("SettingsPage autofire rate slider (Issue 3b)", () => {
  it("exposes the autofire rate slider and reflects a drag in its label and localStorage", () => {
    renderSettingsPage();

    const autofireRow = screen.getByText(/^Autofire rate: /).closest("div") as HTMLElement;
    const slider = within(autofireRow).getByRole("slider");
    fireEvent.change(slider, { target: { value: "8" } });

    expect(screen.getByText(/Autofire rate: 8\/s/)).toBeInTheDocument();

    fireEvent.mouseUp(slider);
    expect(localStorage.getItem("c64u_remote_input_autofire_rate_hz")).toBe("8");
  });
});

describe("SettingsPage screen orientation lock", () => {
  it("does not re-apply the orientation lock on mount (startup already applies it)", () => {
    renderSettingsPage();

    // A transient mount (e.g. an adjacent swipe-runway slot) must not issue a
    // redundant native ScreenOrientation.lock()/unlock() round-trip; main.tsx
    // already applied the persisted mode at startup.
    expect(applyScreenOrientationMode).not.toHaveBeenCalled();
  });

  it("applies the orientation lock only when the user actually changes it", () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Landscape" }));

    expect(saveScreenOrientationMode).toHaveBeenCalledWith("landscape");
    expect(applyScreenOrientationMode).toHaveBeenCalledTimes(1);
    expect(applyScreenOrientationMode).toHaveBeenCalledWith("landscape");
  });
});

describe("SettingsPage keypad focus ring (C64U Remote)", () => {
  vi.setConfig({ testTimeout: 20000 });

  /**
   * The page is now a set of chapters, so its ring has a level the controls live inside.
   * "OK goes in" — a walk that meets a section header descends into it, which is exactly
   * what a keypad user does and what keeps every control reachable by d-pad alone.
   */
  const stepRing = (): Element | null => {
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    const current = document.activeElement;
    // The ring lands on the section GROUP, whose children are the controls inside it.
    if (current instanceof HTMLElement && current.hasAttribute("data-section-label")) {
      fireEvent.keyDown(document.body, { code: "DpadCenter" });
      return document.activeElement;
    }
    return current;
  };

  const visitByDpadDown = (steps: number): Set<Element> => {
    const visited = new Set<Element>();
    for (let index = 0; index < steps; index += 1) {
      const current = stepRing();
      if (current) visited.add(current);
    }
    return visited;
  };

  const focusByDpadDown = (target: Element, steps = 120): void => {
    for (let index = 0; index < steps && document.activeElement !== target; index += 1) {
      stepRing();
    }
    expect(document.activeElement).toBe(target);
  };

  it("keeps connection fields and primary CTAs reachable by d-pad", () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderSettingsPageInFocusRing(focusContext);

    const nameRow = screen.getByTestId("settings-device-name-field");
    const hostRow = screen.getByTestId("settings-device-host-field");
    const httpRow = screen.getByTestId("settings-device-http-field");
    const ftpRow = screen.getByTestId("settings-device-ftp-field");
    const telnetRow = screen.getByTestId("settings-device-telnet-field");
    const saveButton = screen.getByRole("button", { name: /save & connect/i });
    const refreshButton = screen.getByLabelText("Refresh connection");

    // Field rows are intentionally descriptor-only wrappers so d-pad navigation
    // can leave the row before the inner editable input receives text keys. The
    // primary CTA buttons themselves must still be backed by DOM discovery.
    expect(focusContext.current?.engine.sourceForId("settings-device-name-field")).toBe("explicit");
    expect(focusContext.current?.engine.sourceForId("settings-device-host-field")).toBe("explicit");
    expect(focusContext.current?.engine.sourceForId("settings-save-connection")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("settings-refresh-connection")).toBe("dom+explicit");

    const visited = visitByDpadDown(80);
    for (const element of [nameRow, hostRow, httpRow, ftpRow, telnetRow, saveButton, refreshButton]) {
      expect(visited.has(element)).toBe(true);
    }
  });

  it("center-activates the focused connection CTA only (Save & Connect, not Refresh)", async () => {
    mockSwitchSavedDevice.mockResolvedValue(undefined);
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPageInFocusRing();

    focusByDpadDown(screen.getByRole("button", { name: /save & connect/i }));
    fireEvent.keyDown(document.body, { code: "DpadCenter" });

    await Promise.resolve();
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith("c64u", undefined);
    expect(discoverConnection).not.toHaveBeenCalledWith("manual");
  });

  it("center-activates Refresh after stepping to it", async () => {
    vi.mocked(discoverConnection).mockResolvedValue(undefined);

    renderSettingsPageInFocusRing();

    // Focus Refresh through real d-pad traversal, then center triggers the manual
    // discovery path (a refresh uses the "manual" intent; save/mount never do).
    focusByDpadDown(screen.getByLabelText("Refresh connection"));

    fireEvent.keyDown(document.body, { code: "DpadCenter" });

    await Promise.resolve();
    await Promise.resolve();
    expect(discoverConnection).toHaveBeenCalledWith("manual");
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it("skips the Refresh CTA while a connection attempt is in flight", () => {
    // A disabled CTA must be unreachable: with a connect in flight, Refresh is
    // disabled, so d-pad never lands on it and the ring holds only Save & Connect.
    connectionPayloadRef.current.status.isConnecting = true;

    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderSettingsPageInFocusRing(focusContext);

    const saveButton = screen.getByRole("button", { name: /save & connect/i });
    const refreshButton = screen.getByLabelText("Refresh connection");
    expect(screen.getByLabelText("Refresh connection")).toBeDisabled();

    const visited = visitByDpadDown(80);
    expect(visited.has(saveButton)).toBe(true);
    expect(visited.has(refreshButton)).toBe(false);
    expect(focusContext.current?.engine.sourceForId("settings-refresh-connection")).toBeNull();
  });

  it("leaves the connection CTAs inert without a focus provider (default variant)", () => {
    renderSettingsPage();

    const saveButton = screen.getByRole("button", { name: /save & connect/i });

    // No provider means no global key listener, so d-pad keys never move focus —
    // pointer behaviour in the default C64 Commander variant is untouched.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).not.toBe(saveButton);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Refresh connection"));
  });
});
