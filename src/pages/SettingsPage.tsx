/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Wifi,
  Moon,
  Sun,
  Monitor,
  Lock,
  RefreshCw,
  ExternalLink,
  Info,
  FileText,
  Cpu,
  Play,
  Bell,
  Globe,
  Plus,
  Trash,
  Search,
} from "lucide-react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { useSavedDeviceSwitching } from "@/hooks/useSavedDeviceSwitching";
import { C64_DEFAULTS, resolveDeviceHostFromStorage } from "@/lib/c64api";
import { buildDeviceHostWithHttpPort, getDeviceHostHttpPort, stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { cn } from "@/lib/utils";
import { AppBar } from "@/components/AppBar";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { useThemeContext } from "@/components/ThemeProvider";
import { SavedDeviceEditorFields } from "@/components/devices/SavedDeviceEditorFields";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { reportUserError } from "@/lib/uiErrors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogFooter, DialogHeader, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { addErrorLog, addLog } from "@/lib/logging";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { primeDiagnosticsOverlaySuppression } from "@/lib/diagnostics/diagnosticsOverlayState";
import { getSettingsDocumentationLink } from "@/lib/docs/externalResources";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { useListPreviewLimit } from "@/hooks/useListPreviewLimit";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { useActionTrace } from "@/hooks/useActionTrace";
import { clampListPreviewLimit } from "@/lib/uiPreferences";
import { getBuildInfo, getBuildInfoRows } from "@/lib/buildInfo";
import {
  getHvscBaseUrl,
  getHvscBaseUrlOverride,
  getHvscLastUpdateCheckAt,
  getHvscUpdateCheckIntervalDays,
  MIN_HVSC_UPDATE_CHECK_INTERVAL_DAYS,
  setHvscBaseUrlOverride,
  setHvscUpdateCheckIntervalDays,
} from "@/lib/hvsc/hvscReleaseService";
import {
  APP_SETTINGS_KEYS,
  DEFAULT_CONFIG_WRITE_INTERVAL_MS,
  loadArchiveClientIdOverride,
  loadArchiveHostOverride,
  loadArchiveUserAgentOverride,
  clampConfigWriteIntervalMs,
  clampDiscoveryProbeTimeoutMs,
  clampVolumeSliderPreviewIntervalMs,
  loadConfigWriteIntervalMs,
  clampBackgroundRediscoveryIntervalMs,
  clampStartupDiscoveryWindowMs,
  loadDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadDiscoveryProbeTimeoutMs,
  loadStartupDiscoveryWindowMs,
  loadDebugLoggingEnabled,
  loadDiskAutostartMode,
  loadVolumeSliderPreviewIntervalMs,
  saveDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDiscoveryProbeTimeoutMs,
  saveStartupDiscoveryWindowMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiskAutostartMode,
  saveVolumeSliderPreviewIntervalMs,
  loadNotificationVisibility,
  saveNotificationVisibility,
  loadNotificationDurationMs,
  saveNotificationDurationMs,
  NOTIFICATION_DURATION_MIN_MS,
  NOTIFICATION_DURATION_MAX_MS,
  loadScreenOrientationMode,
  loadHideStatusBar,
  saveHideStatusBar,
  loadHideNavigationBar,
  saveHideNavigationBar,
  saveArchiveClientIdOverride,
  saveArchiveHostOverride,
  saveArchiveUserAgentOverride,
  saveScreenOrientationMode,
  type DiskAutostartMode,
  type NotificationVisibility,
  type ScreenOrientationMode,
} from "@/lib/config/appSettings";
import { applyFullScreenFromSettings } from "@/lib/native/fullScreen";
import {
  getActiveAutoResolutionContext,
  loadDeviceSafetyConfig,
  saveDeviceSafetyMode,
  saveFtpMaxConcurrency,
  saveRestMaxConcurrency,
  saveInfoCacheMs,
  saveConfigsCacheMs,
  saveConfigsCooldownMs,
  saveDrivesCooldownMs,
  saveFtpListCooldownMs,
  saveBackoffBaseMs,
  saveBackoffMaxMs,
  saveBackoffFactor,
  saveCircuitBreakerThreshold,
  saveCircuitBreakerCooldownMs,
  saveDiscoveryProbeIntervalMs,
  saveAllowUserOverrideCircuit,
  resetDeviceSafetyOverrides,
  type DeviceSafetyMode,
} from "@/lib/config/deviceSafetySettings";
import { exportSettingsJson, importSettingsJson } from "@/lib/config/settingsTransfer";
import { validateDeviceHost } from "@/lib/validation/connectionValidation";
import { getStoredFtpPort, setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { FolderPicker, type SafPersistedUri } from "@/lib/native/folderPicker";
import { getPlatform } from "@/lib/native/platform";
import { redactTreeUri } from "@/lib/native/safUtils";
import { discoverConnection } from "@/lib/connection/connectionManager";
import { evaluateNewDeviceReachability } from "@/lib/connection/addDeviceReachability";
import { useConnectionState } from "@/hooks/useConnectionState";
import { useDeviceDiscovery } from "@/hooks/useDeviceDiscovery";
import { useNavigate } from "react-router-dom";
import { DISPLAY_PROFILE_OVERRIDE_LABELS, DISPLAY_PROFILE_OVERRIDE_SEQUENCE } from "@/lib/displayProfiles";
import { useDisplayProfile, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";
import { PageContainer, PageStack, ProfileSplitSection } from "@/components/layout/PageContainer";
import { buildDefaultArchiveClientConfig, validateArchiveHost, resolveArchiveClientConfig } from "@/lib/archive/config";
import { OnlineArchiveDialog } from "@/components/archive/OnlineArchiveDialog";
import { getStoredTelnetPort, setStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import {
  buildSavedDeviceEditorDraft,
  type SavedDeviceEditorDraft,
  validateSavedDevicePorts,
} from "@/lib/savedDevices/deviceEditor";
import {
  addSavedDevice,
  buildSavedDevicePrimaryLabel,
  getSavedDevicesSnapshot,
  removeSavedDevice,
  resolveCanonicalProductFamilyCode,
  updateSavedDevice,
  validateSavedDeviceName,
} from "@/lib/savedDevices/store";
import {
  getSavedDeviceDependencySummary,
  type SavedDeviceDependencySummary,
} from "@/lib/savedDevices/deviceDependencies";
import { clearPasswordForDevice, getPasswordForDevice, setPasswordForDevice } from "@/lib/secureStorage";
import { FEATURE_FLAG_DEFINITIONS, FEATURE_FLAG_GROUPS } from "@/lib/config/featureFlags";
import { isDefaultT9InputEnabled } from "@/lib/input/t9Defaults";
import { applyScreenOrientationMode } from "@/lib/native/screenOrientation";
import { persistDiscoveredDevice, startDeviceDiscovery } from "@/lib/deviceDiscovery/discoveryManager";
import { formatDiscoveredDeviceSubtitle, formatDiscoveredDeviceTitle } from "@/lib/deviceDiscovery/display";
import type { DeviceDiscoveryCandidate } from "@/lib/deviceDiscovery/types";

type Theme = "light" | "dark" | "system";

const DEVICE_PRODUCT_DISPLAY_LABELS = {
  C64U: "C64U",
  U64: "U64",
  U64E: "U64 Elite",
  U64E2: "U64 Elite II",
  U2: "Ultimate II",
} as const;

const toPresetLabel = (value: string | null | undefined) => {
  if (!value) return "Balanced";
  return value.charAt(0) + value.slice(1).toLowerCase();
};

const isValidConnectionPort = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
};

const isOfflineSwitchResult = (
  value: unknown,
): value is { ok: false; error?: string | null; authRequired?: boolean } =>
  typeof value === "object" && value !== null && "ok" in value && (value as { ok?: unknown }).ok === false;

// The device answered but rejected the password (HTTP 401/403) — this is not the same
// failure as an unreachable device, and must not be reported as one (HARD9-028).
const describeSwitchFailure = (
  verification: { error?: string | null; authRequired?: boolean },
  fallbackMessage: string,
): string =>
  verification.authRequired
    ? "The device rejected the password. Check the password and try again."
    : (verification.error ?? fallbackMessage);

export default function SettingsPage() {
  const { profile } = useDisplayProfile();
  const navigate = useNavigate();
  const { status, baseUrl, runtimeBaseUrl, deviceHost, updateConfig, refetch } = useC64Connection();
  const savedDevices = useSavedDevices();
  const switchSavedDevice = useSavedDeviceSwitching();
  const connectionSnapshot = useConnectionState();
  const deviceDiscovery = useDeviceDiscovery();
  const { theme, setTheme } = useThemeContext();
  const { isDeveloperModeEnabled, enableDeveloperMode } = useDeveloperMode();
  const { flags, resolved, setFlag } = useFeatureFlags();
  const { limit: listPreviewLimit, setLimit: setListPreviewLimit } = useListPreviewLimit();
  const {
    override: displayProfileOverride,
    autoProfile,
    setOverride: setDisplayProfileOverride,
  } = useDisplayProfilePreference();
  const trace = useActionTrace("SettingsPage");
  const buildInfo = getBuildInfo();
  const buildInfoRows = getBuildInfoRows(buildInfo);
  const settingsDocumentationLink = getSettingsDocumentationLink();
  // The saved device's real password is never loaded into this ref/state (HARD9-004):
  // both start empty and only ever hold what the user has actually typed this session.
  const passwordInputRef = useRef("");

  const [passwordInput, setPasswordInput] = useState("");
  // Whether the password field is showing an editable draft. Starts `true` (editable)
  // and is corrected to match the selected device on the first effect pass below.
  const [passwordEditing, setPasswordEditing] = useState(true);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<SavedDeviceEditorDraft>(() =>
    buildSavedDeviceEditorDraft(
      {
        name: stripPortFromDeviceHost(deviceHost),
        host: stripPortFromDeviceHost(deviceHost),
        httpPort: getDeviceHostHttpPort(deviceHost, runtimeBaseUrl),
        ftpPort: getStoredFtpPort(),
        telnetPort: getStoredTelnetPort(),
      },
      stripPortFromDeviceHost(deviceHost),
    ),
  );
  const [deviceNameError, setDeviceNameError] = useState<string | null>(null);
  const [hostnameError, setHostnameError] = useState<string | null>(null);
  const [connectionFieldError, setConnectionFieldError] = useState<string | null>(null);
  // Calm IP-rescue hint: set when an entered hostname is unreachable but the device was
  // found on the LAN at this address (so we steer the user to it instead of failing).
  const [reachabilitySuggestion, setReachabilitySuggestion] = useState<{ address: string } | null>(null);
  const [discoveryPasswordCandidate, setDiscoveryPasswordCandidate] = useState<DeviceDiscoveryCandidate | null>(null);
  // Id of the discovered device currently being persisted+switched, so the Use / confirm
  // controls lock while a switch is in flight (no double-submit, no self-inflicted overload
  // of the c64u which drops out when hammered).
  const [discoverySwitchBusyId, setDiscoverySwitchBusyId] = useState<string | null>(null);
  const [discoveryPasswordInput, setDiscoveryPasswordInput] = useState("");
  const [discoveryPasswordError, setDiscoveryPasswordError] = useState<string | null>(null);
  const runtimeDeviceHost = stripPortFromDeviceHost(deviceHost);
  const runtimeHttpPort = getDeviceHostHttpPort(deviceHost, runtimeBaseUrl);
  const isDemoActive = status.state === "DEMO_ACTIVE";
  const selectedSavedDevice =
    savedDevices.devices.find((device) => device.id === savedDevices.selectedDeviceId) ??
    savedDevices.devices[0] ??
    null;
  const lastProbeSucceededAtMs = connectionSnapshot.lastProbeSucceededAtMs;
  const lastProbeFailedAtMs = connectionSnapshot.lastProbeFailedAtMs;
  const [isSaving, setIsSaving] = useState(false);
  const [connectionRefreshInFlight, setConnectionRefreshInFlight] = useState(false);
  // Keypad focus ring (C64U Remote): register the Connection card's primary
  // CTAs so the touch-off device can save/connect, refresh, and scan with no taps. Inert
  // in the default variant (no provider listener) and skipped while disabled, so
  // pointer behaviour is unchanged. Orders read top→bottom on the Settings page;
  // lower bands (100 Appearance, 200 saved-devices/host field) stay reserved for
  // later registration above these buttons.
  const saveConnectionFocusRef = useFocusItem<HTMLButtonElement>({
    id: "settings-save-connection",
    order: 300,
    group: "settings-connection",
    disabled: isSaving,
  });
  const refreshConnectionFocusRef = useFocusItem<HTMLButtonElement>({
    id: "settings-refresh-connection",
    order: 310,
    group: "settings-connection",
    disabled: status.isConnecting || connectionRefreshInFlight,
  });
  const discoverDevicesFocusRef = useFocusItem<HTMLButtonElement>({
    id: "settings-discover-devices",
    order: 320,
    group: "settings-connection",
    disabled: deviceDiscovery.phase === "scanning",
  });
  const [deleteDependencySummary, setDeleteDependencySummary] = useState<SavedDeviceDependencySummary | null>(null);
  const [deleteWarningOpen, setDeleteWarningOpen] = useState(false);
  const [deleteDependencyBusy, setDeleteDependencyBusy] = useState(false);
  const [listPreviewInput, setListPreviewInput] = useState(String(listPreviewLimit));
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(loadDebugLoggingEnabled());
  const [configWriteIntervalMs, setConfigWriteIntervalMs] = useState(loadConfigWriteIntervalMs());
  const [demoModeEnabled, setDemoModeEnabled] = useState(loadDemoModeEnabled());
  const [diskAutostartMode, setDiskAutostartMode] = useState<DiskAutostartMode>(loadDiskAutostartMode());
  const [volumeSliderPreviewIntervalMs, setVolumeSliderPreviewIntervalMs] = useState(
    loadVolumeSliderPreviewIntervalMs(),
  );
  const [startupDiscoveryWindowInput, setStartupDiscoveryWindowInput] = useState(
    String(loadStartupDiscoveryWindowMs() / 1000),
  );
  const [backgroundRediscoveryIntervalInput, setBackgroundRediscoveryIntervalInput] = useState(
    String(loadBackgroundRediscoveryIntervalMs() / 1000),
  );
  const [probeTimeoutInput, setProbeTimeoutInput] = useState(String(loadDiscoveryProbeTimeoutMs() / 1000));
  const [deviceSafetyConfig, setDeviceSafetyConfig] = useState(() => loadDeviceSafetyConfig());
  const [deviceSafetyMode, setDeviceSafetyMode] = useState<DeviceSafetyMode>(deviceSafetyConfig.mode);
  const [pendingSafetyMode, setPendingSafetyMode] = useState<DeviceSafetyMode | null>(null);
  const [relaxedWarningOpen, setRelaxedWarningOpen] = useState(false);
  const [ftpConcurrencyInput, setFtpConcurrencyInput] = useState(String(deviceSafetyConfig.ftpMaxConcurrency));
  const [restConcurrencyInput, setRestConcurrencyInput] = useState(String(deviceSafetyConfig.restMaxConcurrency));
  const [infoCacheInput, setInfoCacheInput] = useState(String(deviceSafetyConfig.infoCacheMs));
  const [configsCacheInput, setConfigsCacheInput] = useState(String(deviceSafetyConfig.configsCacheMs));
  const [configsCooldownInput, setConfigsCooldownInput] = useState(String(deviceSafetyConfig.configsCooldownMs));
  const [drivesCooldownInput, setDrivesCooldownInput] = useState(String(deviceSafetyConfig.drivesCooldownMs));
  const [ftpCooldownInput, setFtpCooldownInput] = useState(String(deviceSafetyConfig.ftpListCooldownMs));
  const [backoffBaseInput, setBackoffBaseInput] = useState(String(deviceSafetyConfig.backoffBaseMs));
  const [backoffMaxInput, setBackoffMaxInput] = useState(String(deviceSafetyConfig.backoffMaxMs));
  const [backoffFactorInput, setBackoffFactorInput] = useState(String(deviceSafetyConfig.backoffFactor));
  const [circuitThresholdInput, setCircuitThresholdInput] = useState(
    String(deviceSafetyConfig.circuitBreakerThreshold),
  );
  const [circuitCooldownInput, setCircuitCooldownInput] = useState(String(deviceSafetyConfig.circuitBreakerCooldownMs));
  const [probeIntervalInput, setProbeIntervalInput] = useState(String(deviceSafetyConfig.discoveryProbeIntervalMs));
  const [allowCircuitOverride, setAllowCircuitOverride] = useState(deviceSafetyConfig.allowUserOverrideCircuit);
  const [notificationVisibility, setNotificationVisibility] =
    useState<NotificationVisibility>(loadNotificationVisibility);
  const [notificationDurationMs, setNotificationDurationMs] = useState(loadNotificationDurationMs);
  const [screenOrientationMode, setScreenOrientationMode] = useState<ScreenOrientationMode>(loadScreenOrientationMode);
  const [hideStatusBar, setHideStatusBar] = useState(loadHideStatusBar);
  const [hideNavigationBar, setHideNavigationBar] = useState(loadHideNavigationBar);
  const [hvscBaseUrlInput, setHvscBaseUrlInput] = useState(() => getHvscBaseUrlOverride() ?? "");
  const [hvscBaseUrlPreview, setHvscBaseUrlPreview] = useState(() => getHvscBaseUrl());
  const [hvscUpdateCheckIntervalInput, setHvscUpdateCheckIntervalInput] = useState(() =>
    String(getHvscUpdateCheckIntervalDays()),
  );
  const [hvscLastUpdateCheckAt] = useState(() => getHvscLastUpdateCheckAt());
  const [archiveHostOverride, setArchiveHostOverride] = useState(loadArchiveHostOverride());
  const [archiveClientIdOverride, setArchiveClientIdOverride] = useState(loadArchiveClientIdOverride());
  const [archiveUserAgentOverride, setArchiveUserAgentOverride] = useState(loadArchiveUserAgentOverride());
  const [archiveHostError, setArchiveHostError] = useState<string | null>(() =>
    validateArchiveHost(loadArchiveHostOverride()),
  );
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [safUris, setSafUris] = useState<SafPersistedUri[]>([]);
  const [safEntries, setSafEntries] = useState<Array<{ name: string; path: string; type: string }>>([]);
  const [safBusy, setSafBusy] = useState(false);
  const [safError, setSafError] = useState<string | null>(null);
  const devTapTimestamps = useRef<number[]>([]);
  const settingsFileInputRef = useRef<HTMLInputElement | null>(null);
  const isAndroid = getPlatform() === "android";
  const featureGroups = useMemo(
    () =>
      Object.entries(FEATURE_FLAG_GROUPS)
        .map(([groupKey, metadata]) => ({
          key: groupKey,
          metadata,
          features: FEATURE_FLAG_DEFINITIONS.filter((definition) => definition.group === groupKey)
            .map((definition) => resolved[definition.id])
            .filter((feature) => feature.visible),
        }))
        .filter((group) => group.features.length > 0),
    [resolved],
  );
  const commoserveEnabled = flags.commoserve_enabled;
  const hvscEnabled = flags.hvsc_enabled;
  const demoModeFeatureEnabled = flags.demo_mode_enabled;
  const resolvedArchiveConfig = useMemo(
    () =>
      resolveArchiveClientConfig(
        buildDefaultArchiveClientConfig({
          enabled: commoserveEnabled,
          hostOverride: archiveHostOverride,
          clientIdOverride: archiveClientIdOverride,
          userAgentOverride: archiveUserAgentOverride,
        }),
      ),
    [archiveClientIdOverride, archiveHostOverride, archiveUserAgentOverride, commoserveEnabled],
  );
  const safetyResolutionContext = useMemo(
    () => getActiveAutoResolutionContext(),
    [savedDevices.selectedDeviceId, savedDevices.devices, savedDevices.summaries],
  );
  const autoSafetyDescription = useMemo(() => {
    const resolution = deviceSafetyConfig.resolution;
    if (deviceSafetyMode !== "AUTO" || !resolution) {
      return null;
    }
    const presetLabel = toPresetLabel(resolution.resolvedPreset ?? resolution.effectiveMode);
    if (resolution.isProvisional) {
      return `Effective preset: ${presetLabel} (provisional - no verified product yet for this device).`;
    }
    const productLabel =
      (safetyResolutionContext.activeProduct && DEVICE_PRODUCT_DISPLAY_LABELS[safetyResolutionContext.activeProduct]) ||
      "active device";
    return `Effective preset: ${presetLabel} - resolved from active device (${productLabel}, verified).`;
  }, [deviceSafetyConfig.resolution, deviceSafetyMode, safetyResolutionContext.activeProduct]);
  const isRelaxedSafetyActive = useMemo(() => {
    if (deviceSafetyMode === "RELAXED") {
      return true;
    }
    // AUTO resolves per-device to a concrete preset (Conservative/Balanced); surface the
    // hardware-stability warning only when the effective preset is actually RELAXED.
    return deviceSafetyConfig.resolution?.effectiveMode === "RELAXED";
  }, [deviceSafetyMode, deviceSafetyConfig.resolution]);
  const commitHvscBaseUrl = useCallback(() => {
    const trimmed = hvscBaseUrlInput.trim();
    setHvscBaseUrlOverride(trimmed || null);
    const resolved = getHvscBaseUrl();
    setHvscBaseUrlInput(trimmed ? resolved : "");
    setHvscBaseUrlPreview(resolved);
  }, [hvscBaseUrlInput]);

  const commitHvscUpdateCheckInterval = useCallback(() => {
    const normalized = setHvscUpdateCheckIntervalDays(hvscUpdateCheckIntervalInput);
    setHvscUpdateCheckIntervalInput(String(normalized));
  }, [hvscUpdateCheckIntervalInput]);

  useEffect(() => {
    if (!selectedSavedDevice) {
      return;
    }
    setDeviceDraft(buildSavedDeviceEditorDraft(selectedSavedDevice, selectedSavedDevice.host));
    setDeviceNameError(null);
    setHostnameError(null);
    setConnectionFieldError(null);
    setReachabilitySuggestion(null);
  }, [
    selectedSavedDevice?.id,
    selectedSavedDevice?.name,
    selectedSavedDevice?.host,
    selectedSavedDevice?.httpPort,
    selectedSavedDevice?.ftpPort,
    selectedSavedDevice?.telnetPort,
  ]);

  // The password field never loads the real secret (HARD9-004): switching the selected
  // device (or its hasPassword flag changing after a save) just resets to an empty draft,
  // locked/read-only when a password is already saved, directly editable otherwise. This
  // also removes the write race from HARD9-025 — nothing here overwrites an in-progress
  // keystroke, since no effect mirrors live connection/password state into this field.
  useEffect(() => {
    if (!selectedSavedDevice) {
      return;
    }
    setPasswordInput("");
    passwordInputRef.current = "";
    setPasswordEditing(!selectedSavedDevice.hasPassword);
    setPasswordError(null);
  }, [selectedSavedDevice?.id, selectedSavedDevice?.hasPassword]);

  const handleDeviceDraftChange = useCallback(
    (nextDraft: SavedDeviceEditorDraft) => {
      setDeviceDraft(nextDraft);
      // Any host edit makes a previous IP suggestion stale.
      setReachabilitySuggestion(null);
      if (selectedSavedDevice && deviceNameError) {
        setDeviceNameError(
          validateSavedDeviceName(savedDevices.devices, selectedSavedDevice.id, nextDraft.name, nextDraft.host),
        );
      }
      if (hostnameError) {
        setHostnameError(validateDeviceHost(nextDraft.host));
      }
      if (connectionFieldError) {
        setConnectionFieldError(validateSavedDevicePorts(nextDraft));
      }
    },
    [connectionFieldError, deviceNameError, hostnameError, savedDevices.devices, selectedSavedDevice],
  );

  const handleUseSuggestedAddress = useCallback((address: string) => {
    setReachabilitySuggestion(null);
    setHostnameError(null);
    setDeviceDraft((current) => ({ ...current, host: address }));
  }, []);

  useEffect(() => {
    setListPreviewInput(String(listPreviewLimit));
  }, [listPreviewLimit]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string; value?: unknown } | undefined;
      if (!detail?.key) return;
      if (detail.key === APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY) {
        setDebugLoggingEnabled(Boolean(detail.value));
      }
      if (detail.key === APP_SETTINGS_KEYS.CONFIG_WRITE_INTERVAL_KEY) {
        setConfigWriteIntervalMs(loadConfigWriteIntervalMs());
      }
      if (detail.key === APP_SETTINGS_KEYS.DEMO_MODE_ENABLED_KEY) {
        setDemoModeEnabled(loadDemoModeEnabled());
      }
      if (detail.key === APP_SETTINGS_KEYS.STARTUP_DISCOVERY_WINDOW_MS_KEY) {
        setStartupDiscoveryWindowInput(String(loadStartupDiscoveryWindowMs() / 1000));
      }
      if (detail.key === APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY) {
        setBackgroundRediscoveryIntervalInput(String(loadBackgroundRediscoveryIntervalMs() / 1000));
      }
      if (detail.key === APP_SETTINGS_KEYS.DISCOVERY_PROBE_TIMEOUT_MS_KEY) {
        setProbeTimeoutInput(String(loadDiscoveryProbeTimeoutMs() / 1000));
      }
      if (detail.key === APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY) {
        setDiskAutostartMode(loadDiskAutostartMode());
      }
      if (detail.key === APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY) {
        setVolumeSliderPreviewIntervalMs(loadVolumeSliderPreviewIntervalMs());
      }
      if (detail.key === APP_SETTINGS_KEYS.ARCHIVE_HOST_OVERRIDE_KEY) {
        const next = loadArchiveHostOverride();
        setArchiveHostOverride(next);
        setArchiveHostError(validateArchiveHost(next));
      }
      if (detail.key === APP_SETTINGS_KEYS.ARCHIVE_CLIENT_ID_OVERRIDE_KEY) {
        setArchiveClientIdOverride(loadArchiveClientIdOverride());
      }
      if (detail.key === APP_SETTINGS_KEYS.ARCHIVE_USER_AGENT_OVERRIDE_KEY) {
        setArchiveUserAgentOverride(loadArchiveUserAgentOverride());
      }
    };
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);

  useEffect(() => {
    if (demoModeFeatureEnabled || !demoModeEnabled) {
      return;
    }
    setDemoModeEnabled(false);
    saveDemoModeEnabled(false);
    void discoverConnection("settings");
  }, [demoModeEnabled, demoModeFeatureEnabled]);

  const refreshDeviceSafetyState = useCallback(() => {
    const next = loadDeviceSafetyConfig();
    setDeviceSafetyConfig(next);
    setDeviceSafetyMode(next.mode);
    setFtpConcurrencyInput(String(next.ftpMaxConcurrency));
    setRestConcurrencyInput(String(next.restMaxConcurrency));
    setInfoCacheInput(String(next.infoCacheMs));
    setConfigsCacheInput(String(next.configsCacheMs));
    setConfigsCooldownInput(String(next.configsCooldownMs));
    setDrivesCooldownInput(String(next.drivesCooldownMs));
    setFtpCooldownInput(String(next.ftpListCooldownMs));
    setBackoffBaseInput(String(next.backoffBaseMs));
    setBackoffMaxInput(String(next.backoffMaxMs));
    setBackoffFactorInput(String(next.backoffFactor));
    setCircuitThresholdInput(String(next.circuitBreakerThreshold));
    setCircuitCooldownInput(String(next.circuitBreakerCooldownMs));
    setProbeIntervalInput(String(next.discoveryProbeIntervalMs));
    setAllowCircuitOverride(next.allowUserOverrideCircuit);
  }, []);

  useEffect(() => {
    const handler = () => refreshDeviceSafetyState();
    window.addEventListener("c64u-device-safety-updated", handler);
    return () => window.removeEventListener("c64u-device-safety-updated", handler);
  }, [refreshDeviceSafetyState]);

  const refreshSafPermissions = async () => {
    if (!isAndroid) return;
    setSafBusy(true);
    setSafError(null);
    try {
      const result = await FolderPicker.getPersistedUris();
      setSafUris(result?.uris ?? []);
      addLog("debug", "SAF persisted URIs (manual)", {
        count: result?.uris?.length ?? 0,
        uris: (result?.uris ?? []).map((entry) => redactTreeUri(entry.uri)),
      });
    } catch (error) {
      const message = (error as Error).message;
      setSafError(message);
      addErrorLog("SAF persisted URI lookup failed", { error: message });
    } finally {
      setSafBusy(false);
    }
  };

  const enumerateSafRoot = async () => {
    if (!isAndroid) return;
    const treeUri = safUris[0]?.uri;
    if (!treeUri) {
      reportUserError({
        operation: "SAF_DIAGNOSTICS",
        title: "SAF diagnostics",
        description: "No persisted SAF permissions found.",
      });
      return;
    }
    setSafBusy(true);
    setSafError(null);
    try {
      const result = await FolderPicker.listChildren({ treeUri, path: "/" });
      setSafEntries(result.entries ?? []);
      addLog("debug", "SAF diagnostic enumeration", {
        treeUri: redactTreeUri(treeUri),
        entries: result.entries?.length ?? 0,
      });
    } catch (error) {
      const message = (error as Error).message;
      setSafError(message);
      addErrorLog("SAF enumeration failed", { error: message });
    } finally {
      setSafBusy(false);
    }
  };

  const handleSaveConnection = trace(async function handleSaveConnection() {
    if (!selectedSavedDevice) return;
    const hostError = validateDeviceHost(deviceDraft.host);
    setHostnameError(hostError);
    const nextDeviceNameError = validateSavedDeviceName(
      savedDevices.devices,
      selectedSavedDevice.id,
      deviceDraft.name,
      deviceDraft.host,
    );
    setDeviceNameError(nextDeviceNameError);
    const portError = validateSavedDevicePorts(deviceDraft);
    setConnectionFieldError(portError);
    if (hostError || portError || nextDeviceNameError) return;
    const nextHost = stripPortFromDeviceHost(deviceDraft.host.trim() || C64_DEFAULTS.DEFAULT_DEVICE_HOST);
    const nextDeviceHost = buildDeviceHostWithHttpPort(nextHost, Number(deviceDraft.httpPort));
    // The field never displays the real saved secret (HARD9-004): while `passwordEditing`
    // is false the user hasn't touched it, so reuse the stored password unchanged instead
    // of the empty value that's actually sitting in the (never-shown) input.
    const isChangingPassword = passwordEditing;
    const typedPassword = passwordInputRef.current.trim();
    const effectivePassword = isChangingPassword
      ? typedPassword
      : selectedSavedDevice.hasPassword
        ? ((await getPasswordForDevice(selectedSavedDevice.id)) ?? "")
        : "";
    const hasPassword = effectivePassword.length > 0;
    setPasswordError(null);
    setIsSaving(true);
    try {
      // Pre-commit reachability gate: never persist an unreachable device. When an
      // entered hostname can't be reached but the device is found on the LAN, calmly
      // steer the user to its IP address instead of failing silently.
      const reachability = await evaluateNewDeviceReachability({
        host: nextHost,
        deviceHost: nextDeviceHost,
        password: hasPassword ? effectivePassword : null,
      });
      if (reachability.status === "unreachable") {
        if (reachability.suggestedAddress) {
          setReachabilitySuggestion({ address: reachability.suggestedAddress });
          setHostnameError(null);
        } else {
          setReachabilitySuggestion(null);
          setHostnameError(
            `We couldn’t reach “${nextHost}”. Make sure it’s powered on and on the same Wi‑Fi, or enter its IP address.`,
          );
        }
        return;
      }
      if (reachability.status === "needs-password" && isChangingPassword && hasPassword) {
        // The just-typed password was itself rejected by the device. A wrong password
        // must never be persisted (HARD9-004) — surface it as an auth failure, not a save.
        setPasswordError("Wrong password for this device.");
        return;
      }
      setReachabilitySuggestion(null);
      setStoredFtpPort(Number(deviceDraft.ftpPort));
      setStoredTelnetPort(Number(deviceDraft.telnetPort));
      if (isChangingPassword) {
        if (hasPassword) {
          await setPasswordForDevice(selectedSavedDevice.id, effectivePassword);
        } else {
          await clearPasswordForDevice(selectedSavedDevice.id);
        }
      }
      updateSavedDevice(selectedSavedDevice.id, {
        name: deviceDraft.name,
        nameSource: deviceDraft.nameSource,
        host: nextHost,
        httpPort: Number(deviceDraft.httpPort),
        ftpPort: Number(deviceDraft.ftpPort),
        telnetPort: Number(deviceDraft.telnetPort),
        hasPassword,
      });
      updateConfig(nextDeviceHost, hasPassword ? effectivePassword : undefined);
      const verification = await switchSavedDevice(selectedSavedDevice.id);
      if (isOfflineSwitchResult(verification)) {
        throw new Error(
          describeSwitchFailure(
            verification,
            `Unable to reach ${nextHost}. Check the hostname/IP address and confirm the device is powered on.`,
          ),
        );
      }
      setPasswordInput("");
      passwordInputRef.current = "";
      setPasswordEditing(!hasPassword);
      toast({ title: "Connection settings saved" });
    } catch (error) {
      reportUserError({
        operation: "CONNECTION_SAVE",
        title: "Unable to save connection",
        description: (error as Error).message,
        error,
        deviceHost: nextHost,
      });
    } finally {
      setIsSaving(false);
    }
  });

  const handleAddSavedDevice = trace(async function handleAddSavedDevice() {
    const nextId =
      (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
      `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;
    addSavedDevice({
      id: nextId,
      name: "",
      host: C64_DEFAULTS.DEFAULT_DEVICE_HOST,
      httpPort: C64_DEFAULTS.DEFAULT_HTTP_PORT,
      ftpPort: getStoredFtpPort(),
      telnetPort: getStoredTelnetPort(),
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });
    await switchSavedDevice(nextId);
  });

  const performDeleteSelectedDevice = trace(async function performDeleteSelectedDevice() {
    if (!selectedSavedDevice) return;
    removeSavedDevice(selectedSavedDevice.id);
    await clearPasswordForDevice(selectedSavedDevice.id);
    const nextSelected = getSavedDevicesSnapshot().selectedDeviceId;
    if (nextSelected) {
      await switchSavedDevice(nextSelected);
    }
  });

  const handleDeleteSelectedDevice = trace(async function handleDeleteSelectedDevice() {
    if (!selectedSavedDevice || deleteDependencyBusy) return;

    setDeleteDependencyBusy(true);
    try {
      const summary = await getSavedDeviceDependencySummary(selectedSavedDevice.id);
      setDeleteDependencySummary(summary);
      setDeleteWarningOpen(true);
    } catch (error) {
      reportUserError({
        operation: "DEVICE_DELETE_DEPENDENCIES",
        title: "Unable to inspect saved device references",
        description: (error as Error).message,
        error,
      });
    } finally {
      setDeleteDependencyBusy(false);
    }
  });

  const confirmDeleteSelectedDevice = trace(async function confirmDeleteSelectedDevice() {
    setDeleteWarningOpen(false);
    setDeleteDependencySummary(null);
    await performDeleteSelectedDevice();
  });

  const handleSelectSavedDevice = trace(async function handleSelectSavedDevice(deviceId: string) {
    await switchSavedDevice(deviceId);
  });

  const handleRefreshConnection = trace(async function handleRefreshConnection() {
    if (connectionRefreshInFlight) return;
    setConnectionRefreshInFlight(true);
    try {
      await discoverConnection("manual");
    } catch (error) {
      reportUserError({
        operation: "CONNECTION_REFRESH",
        title: "Unable to refresh connection",
        description: (error as Error).message,
        error,
      });
    } finally {
      setConnectionRefreshInFlight(false);
    }
  });

  const handleDiscoverDevices = trace(async function handleDiscoverDevices() {
    try {
      await startDeviceDiscovery({ trigger: "settings", includeLanScan: true, timeoutMs: 10_000 });
    } catch (error) {
      reportUserError({
        operation: "DEVICE_DISCOVERY",
        title: "Unable to discover devices",
        description: (error as Error).message,
        error,
      });
    }
  });

  const hasSavedPasswordForDiscoveredDevice = (candidate: DeviceDiscoveryCandidate) => {
    const savedDeviceId = candidate.alreadySavedDeviceId;
    if (!savedDeviceId) return false;
    return Boolean(savedDevices.devices.find((device) => device.id === savedDeviceId)?.hasPassword);
  };

  const handleUseDiscoveredDevice = trace(async function handleUseDiscoveredDevice(
    candidate: DeviceDiscoveryCandidate,
    suppliedPassword?: string,
  ) {
    if (candidate.requiresPassword && !suppliedPassword && !hasSavedPasswordForDiscoveredDevice(candidate)) {
      setDiscoveryPasswordCandidate(candidate);
      setDiscoveryPasswordInput("");
      setDiscoveryPasswordError(null);
      return;
    }
    // Guard against a double-submit racing two persist+switch attempts at the device.
    if (discoverySwitchBusyId) return;
    setDiscoverySwitchBusyId(candidate.id);
    try {
      const persisted = persistDiscoveredDevice(candidate, {
        select: true,
        passwordPresent: Boolean(suppliedPassword),
      });
      if (suppliedPassword) {
        await setPasswordForDevice(persisted.deviceId, suppliedPassword);
      }
      const verification = await switchSavedDevice(persisted.deviceId);
      if (isOfflineSwitchResult(verification)) {
        throw new Error(
          describeSwitchFailure(
            verification,
            `Unable to connect to ${persisted.host}. The device was discovered, but did not answer the follow-up connection check.`,
          ),
        );
      }
      toast({ title: "Discovered device selected" });
      setDiscoveryPasswordCandidate(null);
      setDiscoveryPasswordInput("");
    } catch (error) {
      reportUserError({
        operation: "DEVICE_DISCOVERY_SELECT",
        title: "Unable to select discovered device",
        description: (error as Error).message,
        error,
        deviceHost: candidate.address,
      });
    } finally {
      setDiscoverySwitchBusyId(null);
    }
  });

  const handleConfirmDiscoveryPassword = trace(async function handleConfirmDiscoveryPassword() {
    if (!discoveryPasswordCandidate) return;
    const password = discoveryPasswordInput.trim();
    if (!password) {
      setDiscoveryPasswordError("Enter the network password for this device.");
      return;
    }
    await handleUseDiscoveredDevice(discoveryPasswordCandidate, password);
  });

  const handleDeveloperTap = () => {
    if (isDeveloperModeEnabled) return;
    const now = Date.now();
    const windowMs = 3000;
    const taps = devTapTimestamps.current.filter((timestamp) => now - timestamp < windowMs);
    taps.push(now);
    devTapTimestamps.current = taps;

    if (taps.length >= 7) {
      enableDeveloperMode();
      devTapTimestamps.current = [];
      toast({ title: "Developer mode enabled" });
    }
  };

  const themeOptions: {
    value: Theme;
    icon: React.ElementType;
    label: string;
  }[] = [
    { value: "system", icon: Monitor, label: "Auto" },
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
  ];

  const displayProfileOptions = DISPLAY_PROFILE_OVERRIDE_SEQUENCE.map((value) => ({
    value,
    label: DISPLAY_PROFILE_OVERRIDE_LABELS[value],
  }));
  const screenOrientationOptions: Array<{ value: ScreenOrientationMode; label: string }> = [
    { value: "portrait", label: "Portrait" },
    { value: "landscape", label: "Landscape" },
    { value: "auto", label: "Auto" },
  ];

  useEffect(() => {
    void applyScreenOrientationMode(screenOrientationMode);
  }, [screenOrientationMode]);

  const commitScreenOrientationMode = (mode: ScreenOrientationMode) => {
    setScreenOrientationMode(mode);
    saveScreenOrientationMode(mode);
  };

  const commitHideStatusBar = (enabled: boolean) => {
    setHideStatusBar(enabled);
    saveHideStatusBar(enabled);
    applyFullScreenFromSettings();
  };

  const commitHideNavigationBar = (enabled: boolean) => {
    setHideNavigationBar(enabled);
    saveHideNavigationBar(enabled);
    applyFullScreenFromSettings();
  };

  const commitListPreviewLimit = () => {
    const parsed = Number(listPreviewInput);
    const clamped = clampListPreviewLimit(parsed);
    setListPreviewLimit(clamped);
    setListPreviewInput(String(clamped));
  };

  const commitStartupDiscoveryWindow = () => {
    const parsed = Number(startupDiscoveryWindowInput);
    const clamped = clampStartupDiscoveryWindowMs(Math.round((Number.isFinite(parsed) ? parsed : 3) * 1000));
    saveStartupDiscoveryWindowMs(clamped);
    setStartupDiscoveryWindowInput(String(clamped / 1000));
  };

  const commitBackgroundRediscoveryInterval = () => {
    const parsed = Number(backgroundRediscoveryIntervalInput);
    const clamped = clampBackgroundRediscoveryIntervalMs(Math.round((Number.isFinite(parsed) ? parsed : 5) * 1000));
    saveBackgroundRediscoveryIntervalMs(clamped);
    setBackgroundRediscoveryIntervalInput(String(clamped / 1000));
  };

  const commitProbeTimeout = () => {
    const parsed = Number(probeTimeoutInput);
    const clamped = clampDiscoveryProbeTimeoutMs(Math.round((Number.isFinite(parsed) ? parsed : 2.5) * 1000));
    saveDiscoveryProbeTimeoutMs(clamped);
    setProbeTimeoutInput(String(clamped / 1000));
  };

  const commitDeviceSafetyMode = (mode: DeviceSafetyMode) => {
    if (mode === "RELAXED" && deviceSafetyMode !== "RELAXED") {
      setPendingSafetyMode(mode);
      setRelaxedWarningOpen(true);
      return;
    }
    saveDeviceSafetyMode(mode);
    if (mode === "TROUBLESHOOTING") {
      setDebugLoggingEnabled(true);
      saveDebugLoggingEnabled(true);
    }
    refreshDeviceSafetyState();
  };

  const commitDeviceSafetyNumber = (value: string, commit: (next: number) => void, fallback: number) => {
    const parsed = Number(value);
    commit(Number.isFinite(parsed) ? parsed : fallback);
    refreshDeviceSafetyState();
  };

  const handleConfirmRelaxedMode = () => {
    if (pendingSafetyMode !== "RELAXED") {
      setRelaxedWarningOpen(false);
      setPendingSafetyMode(null);
      return;
    }
    saveDeviceSafetyMode("RELAXED");
    refreshDeviceSafetyState();
    setRelaxedWarningOpen(false);
    setPendingSafetyMode(null);
  };

  const handleCancelRelaxedMode = () => {
    setRelaxedWarningOpen(false);
    setPendingSafetyMode(null);
  };

  const handleExportSettings = trace(function handleExportSettings() {
    void (async () => {
      try {
        const payload = await exportSettingsJson();
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "c64commander-settings.json";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast({ title: "Settings export ready" });
      } catch (error) {
        reportUserError({
          operation: "SETTINGS_EXPORT",
          title: "Settings export failed",
          description: (error as Error).message,
          error,
        });
      }
    })();
  });

  const handleImportSettings = trace(async function handleImportSettings(file?: File | null) {
    if (!file) return;
    try {
      const content = await file.text();
      const result = await importSettingsJson(content);
      if (!result.ok) {
        reportUserError({
          operation: "SETTINGS_IMPORT",
          title: "Settings import failed",
          description: (result as { error: string }).error,
        });
        return;
      }
      refreshDeviceSafetyState();
      setDebugLoggingEnabled(loadDebugLoggingEnabled());
      setConfigWriteIntervalMs(loadConfigWriteIntervalMs());
      setDemoModeEnabled(loadDemoModeEnabled());
      setStartupDiscoveryWindowInput(String(loadStartupDiscoveryWindowMs() / 1000));
      setBackgroundRediscoveryIntervalInput(String(loadBackgroundRediscoveryIntervalMs() / 1000));
      setProbeTimeoutInput(String(loadDiscoveryProbeTimeoutMs() / 1000));
      setDiskAutostartMode(loadDiskAutostartMode());
      const importedArchiveHostOverride = loadArchiveHostOverride();
      setArchiveHostOverride(importedArchiveHostOverride);
      setArchiveHostError(validateArchiveHost(importedArchiveHostOverride));
      setArchiveClientIdOverride(loadArchiveClientIdOverride());
      setArchiveUserAgentOverride(loadArchiveUserAgentOverride());
      toast({ title: "Settings imported" });
    } catch (error) {
      reportUserError({
        operation: "SETTINGS_IMPORT",
        title: "Settings import failed",
        description: (error as Error).message,
        error,
      });
    }
  });
  const pageShellClassName = usePrimaryPageShellClassName();

  return (
    <div className={pageShellClassName}>
      <AppBar title="Settings" />

      <PageContainer size="reading">
        <PageStack>
          <ProfileSplitSection minColumnWidth="20rem" testId="settings-top-layout">
            {/* 1. Appearance */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.02 }}
              className="profile-card bg-card border border-border rounded-xl p-4 space-y-4"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Monitor className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-medium">Appearance</h2>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isActive = theme === option.value;

                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={isActive ? "default" : "outline"}
                      onClick={wrapUserEvent(
                        () => setTheme(option.value),
                        "select",
                        "ThemeSelector",
                        { title: option.label },
                        "ThemeOption",
                      )}
                      className="h-auto flex-col gap-2 whitespace-normal rounded-lg p-4"
                    >
                      <Icon className={`h-6 w-6 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`text-sm ${isActive ? "font-medium" : ""}`}>{option.label}</span>
                    </Button>
                  );
                })}
              </div>

              <div className="space-y-2 rounded-lg border border-border/70 p-3">
                <Label className="text-sm font-medium">Display profile</Label>
                <div className="grid grid-cols-2 gap-2" data-testid="settings-display-profile-override">
                  {displayProfileOptions.map((option) => {
                    const isActive = displayProfileOverride === option.value;
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant={isActive ? "default" : "outline"}
                        className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                        onClick={() => setDisplayProfileOverride(option.value)}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Auto currently resolves to {DISPLAY_PROFILE_OVERRIDE_LABELS[autoProfile]}. Use an override to preview
                  or lock a profile explicitly.
                </p>
                <div className="space-y-2 pt-2">
                  <Label className="text-sm font-medium">Screen orientation</Label>
                  <div
                    className="grid grid-cols-[repeat(auto-fit,minmax(5.75rem,1fr))] gap-2"
                    data-testid="settings-screen-orientation-mode"
                  >
                    {screenOrientationOptions.map((option) => {
                      const isActive = screenOrientationMode === option.value;
                      return (
                        <Button
                          key={option.value}
                          type="button"
                          variant={isActive ? "default" : "outline"}
                          className="h-auto justify-center whitespace-nowrap px-3 py-2 text-center"
                          onClick={() => commitScreenOrientationMode(option.value)}
                        >
                          {option.label}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Choose how the app rotates. Portrait stays upright. Landscape stays wide. Auto follows the phone.
                  </p>
                </div>
                {isAndroid ? (
                  <div className="space-y-2 pt-2" data-testid="settings-full-screen">
                    <Label className="text-sm font-medium">Full screen</Label>
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0">
                        <Label htmlFor="full-screen-hide-status-bar" className="font-medium">
                          Hide status bar
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Extend the app over the top status bar (clock, battery, signal).
                        </p>
                      </div>
                      <Checkbox
                        id="full-screen-hide-status-bar"
                        data-testid="settings-hide-status-bar"
                        checked={hideStatusBar}
                        onCheckedChange={(checked) => commitHideStatusBar(checked === true)}
                      />
                    </div>
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0">
                        <Label htmlFor="full-screen-hide-navigation-bar" className="font-medium">
                          Hide navigation bar
                        </Label>
                        <p className="text-xs text-muted-foreground">Extend the app under the bottom navigation bar.</p>
                      </div>
                      <Checkbox
                        id="full-screen-hide-navigation-bar"
                        data-testid="settings-hide-navigation-bar"
                        checked={hideNavigationBar}
                        onCheckedChange={(checked) => commitHideNavigationBar(checked === true)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>

            {/* 2. Connection Settings */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="profile-card bg-card border border-border rounded-xl p-4 space-y-4"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Wifi className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-medium">Connection</h2>
              </div>

              <div className="space-y-3">
                <div className="space-y-2 rounded-lg border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <div className="min-w-0">
                      <Label className="text-sm font-medium">Saved devices</Label>
                      <p className="text-xs text-muted-foreground">
                        Manage devices here. Long press the header badge to switch quickly.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleAddSavedDevice}
                        aria-label="Add device"
                        title="Add device"
                        data-testid="settings-add-device"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleDeleteSelectedDevice}
                        disabled={!selectedSavedDevice || deleteDependencyBusy}
                        aria-label="Delete device"
                        title="Delete device"
                        data-testid="settings-delete-device"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {savedDevices.devices.map((device) => {
                      const isSelected = device.id === savedDevices.selectedDeviceId;
                      const productCode =
                        device.type?.trim() ||
                        device.lastKnownProduct ||
                        savedDevices.summaries[device.id]?.lastVerifiedProduct ||
                        (isSelected ? resolveCanonicalProductFamilyCode(status.deviceInfo?.product) : null) ||
                        "Unknown";
                      return (
                        <button
                          key={device.id}
                          type="button"
                          className={cn(
                            "flex w-full items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-left transition-colors hover:bg-muted/40",
                            isSelected ? "border-primary/50 bg-primary/5" : "bg-background",
                          )}
                          onClick={() => {
                            void handleSelectSavedDevice(device.id);
                          }}
                          data-testid={`settings-device-row-${device.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {buildSavedDevicePrimaryLabel(device)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {productCode} · {device.host}
                            </p>
                          </div>
                          {isSelected ? (
                            <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Selected
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <SavedDeviceEditorFields
                    draft={deviceDraft}
                    onChange={handleDeviceDraftChange}
                    nameError={deviceNameError}
                    hostError={hostnameError}
                    portError={connectionFieldError}
                    idPrefix="settings-device"
                    hostLabel="C64U Hostname / IP"
                    hostHint="Name or IP shown on your device."
                    onHostBlur={(value) => setHostnameError(validateDeviceHost(value))}
                    reachabilitySuggestion={reachabilitySuggestion}
                    onUseSuggestedAddress={handleUseSuggestedAddress}
                    keypadInput={flags.keypad_input_enabled && isDefaultT9InputEnabled()}
                  />
                  <p className="text-xs text-muted-foreground">
                    Currently using: <span className="font-sans break-all">{runtimeDeviceHost}</span>
                    {` · HTTP ${runtimeHttpPort} · FTP ${getStoredFtpPort()} · Telnet ${getStoredTelnetPort()}`}
                    {isDemoActive ? " (Demo mock)" : ""}
                  </p>
                  {isDemoActive ? (
                    <p className="text-xs text-muted-foreground">
                      {lastProbeSucceededAtMs
                        ? "Real device detected during probe."
                        : lastProbeFailedAtMs
                          ? "No real device detected in recent probe."
                          : "Waiting for initial probe."}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Network Password
                  </Label>
                  {selectedSavedDevice?.hasPassword && !passwordEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        id="password"
                        type="password"
                        value="••••••••"
                        readOnly
                        disabled
                        aria-label="Network Password saved"
                        className="font-sans"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPasswordError(null);
                          setPasswordInput("");
                          passwordInputRef.current = "";
                          setPasswordEditing(true);
                        }}
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        id="password"
                        type="password"
                        value={passwordInput}
                        autoFocus={Boolean(selectedSavedDevice?.hasPassword)}
                        onChange={(e) => {
                          const nextPassword = e.target.value;
                          passwordInputRef.current = nextPassword;
                          setPasswordInput(nextPassword);
                          setPasswordError(null);
                        }}
                        placeholder="Optional"
                        className="font-sans"
                      />
                      {selectedSavedDevice?.hasPassword ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPasswordError(null);
                            setPasswordInput("");
                            passwordInputRef.current = "";
                            setPasswordEditing(false);
                          }}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  )}
                  {passwordError ? (
                    <p className="text-xs text-destructive">{passwordError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {selectedSavedDevice?.hasPassword && !passwordEditing
                        ? "Password saved."
                        : "Only needed if your device uses one."}
                    </p>
                  )}
                </div>
              </div>

              {demoModeFeatureEnabled ? (
                <div className="space-y-4 rounded-lg border border-border/70 p-3">
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="space-y-1 min-w-0">
                      <Label htmlFor="demo-mode-enabled" className="font-medium">
                        Automatic Demo Mode
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Offer the built-in simulated device after real-device discovery fails.
                      </p>
                    </div>
                    <Checkbox
                      id="demo-mode-enabled"
                      checked={demoModeEnabled}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true;
                        setDemoModeEnabled(enabled);
                        saveDemoModeEnabled(enabled);
                      }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex gap-2 pt-2">
                <Button
                  ref={saveConnectionFocusRef}
                  onClick={handleSaveConnection}
                  disabled={isSaving}
                  className="flex-1"
                >
                  {isSaving ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save & Connect
                </Button>
                <Button
                  ref={refreshConnectionFocusRef}
                  variant="outline"
                  onClick={() => void handleRefreshConnection()}
                  disabled={status.isConnecting || connectionRefreshInFlight}
                  aria-label="Refresh connection"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${status.isConnecting || connectionRefreshInFlight ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>

              <div className="space-y-3 border-t border-border/70 pt-4" data-testid="settings-device-discovery">
                <div className="flex flex-col gap-3">
                  <div className="min-w-0 space-y-1">
                    <Label className="text-sm font-medium">Device discovery</Label>
                    <p className="text-xs text-muted-foreground">
                      Find nearby C64 Ultimate devices. You can still type an address above.
                    </p>
                  </div>
                  <Button
                    ref={discoverDevicesFocusRef}
                    type="button"
                    variant="outline"
                    onClick={() => void handleDiscoverDevices()}
                    disabled={deviceDiscovery.phase === "scanning"}
                    className="shrink-0"
                    data-testid="settings-discover-devices"
                  >
                    {deviceDiscovery.phase === "scanning" ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="mr-2 h-4 w-4" />
                    )}
                    Discover devices
                  </Button>
                </div>
                {deviceDiscovery.phase === "scanning" ? (
                  <p className="text-xs text-muted-foreground" data-testid="settings-device-discovery-progress">
                    Scanning. You can leave this page; the scan keeps running.
                  </p>
                ) : null}
                {deviceDiscovery.phase === "error" ? (
                  <p className="text-xs text-destructive" data-testid="settings-device-discovery-error">
                    {deviceDiscovery.error ?? "Device discovery failed."}
                  </p>
                ) : null}
                {deviceDiscovery.phase === "complete" && deviceDiscovery.candidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="settings-device-discovery-empty">
                    {deviceDiscovery.unsupported
                      ? "Automatic discovery isn’t available on this platform. Enter an address above."
                      : "No devices found. You can still type an address above."}
                  </p>
                ) : null}
                {deviceDiscovery.candidates.length > 0 ? (
                  <div className="space-y-2" data-testid="settings-device-discovery-results">
                    {deviceDiscovery.candidates.map((candidate) => {
                      const secondary = formatDiscoveredDeviceSubtitle(candidate);
                      return (
                        <div key={candidate.id} className="rounded-lg border border-border/70 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {formatDiscoveredDeviceTitle(candidate)}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{secondary}</p>
                              {candidate.requiresPassword ? (
                                <p className="text-xs text-muted-foreground">Password required</p>
                              ) : null}
                              {candidate.alreadySavedDeviceId ? (
                                <p className="text-xs text-muted-foreground">Already saved</p>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              variant={candidate.alreadySavedDeviceId ? "secondary" : "outline"}
                              size="sm"
                              onClick={() => void handleUseDiscoveredDevice(candidate)}
                              disabled={Boolean(discoverySwitchBusyId)}
                              data-testid={`settings-use-discovered-device-${candidate.id}`}
                            >
                              {discoverySwitchBusyId === candidate.id ? "Connecting" : "Use"}
                            </Button>
                          </div>
                          {discoveryPasswordCandidate?.id === candidate.id ? (
                            <form
                              className="mt-3 space-y-2 border-t border-border/70 pt-3"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void handleConfirmDiscoveryPassword();
                              }}
                            >
                              <Label htmlFor="settings-device-password" className="text-sm">
                                Network password
                              </Label>
                              <Input
                                id="settings-device-password"
                                type="password"
                                autoFocus
                                value={discoveryPasswordInput}
                                onChange={(event) => {
                                  setDiscoveryPasswordInput(event.target.value);
                                  setDiscoveryPasswordError(null);
                                }}
                                placeholder={formatDiscoveredDeviceTitle(candidate)}
                                data-testid="settings-device-password-input"
                                aria-invalid={discoveryPasswordError ? true : undefined}
                                aria-describedby={
                                  discoveryPasswordError
                                    ? "settings-device-password-error"
                                    : "settings-device-password-help"
                                }
                              />
                              {discoveryPasswordError ? (
                                <p
                                  id="settings-device-password-error"
                                  className="text-xs text-destructive"
                                  role="alert"
                                >
                                  {discoveryPasswordError}
                                </p>
                              ) : (
                                <p id="settings-device-password-help" className="text-xs text-muted-foreground">
                                  This is the device network password configured on the C64 Ultimate.
                                </p>
                              )}
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setDiscoveryPasswordCandidate(null);
                                    setDiscoveryPasswordInput("");
                                    setDiscoveryPasswordError(null);
                                  }}
                                  disabled={Boolean(discoverySwitchBusyId)}
                                  data-testid="settings-device-password-cancel"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={Boolean(discoverySwitchBusyId)}
                                  data-testid="settings-device-password-confirm"
                                >
                                  {discoverySwitchBusyId === candidate.id ? "Connecting" : "Use Device"}
                                </Button>
                              </div>
                            </form>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Connection Status */}
              <div
                className={`break-words rounded-lg p-3 text-sm ${status.isConnected ? "bg-success/10 text-success" : isDemoActive ? "bg-primary/10 text-primary" : status.isConnecting ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"}`}
              >
                <AlertDialog
                  open={deleteWarningOpen}
                  onOpenChange={(open) => {
                    setDeleteWarningOpen(open);
                    if (!open) {
                      setDeleteDependencySummary(null);
                    }
                  }}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete device?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {(deleteDependencySummary?.totalCount ?? 0) > 0 ? (
                          <>
                            Removing{" "}
                            {selectedSavedDevice ? buildSavedDevicePrimaryLabel(selectedSavedDevice) : "this device"}{" "}
                            will disconnect {deleteDependencySummary?.totalCount ?? 0} saved item
                            {(deleteDependencySummary?.totalCount ?? 0) === 1 ? "" : "s"} that still point to it.
                          </>
                        ) : (
                          <>
                            Remove{" "}
                            {selectedSavedDevice ? buildSavedDevicePrimaryLabel(selectedSavedDevice) : "this device"}{" "}
                            from your saved devices? This can&apos;t be undone.
                          </>
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    {(deleteDependencySummary?.totalCount ?? 0) > 0 ? (
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p>Those items will stay in your playlists and disk library.</p>
                        <p>
                          Playlist items: {deleteDependencySummary?.playlistItemCount ?? 0} item
                          {(deleteDependencySummary?.playlistItemCount ?? 0) === 1 ? "" : "s"}
                        </p>
                        <p>
                          Disk library items: {deleteDependencySummary?.diskCount ?? 0} item
                          {(deleteDependencySummary?.diskCount ?? 0) === 1 ? "" : "s"}
                        </p>
                        <p>
                          After you delete the device, those items will no longer open until you import them again or
                          remove them.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p>
                          Remove{" "}
                          {selectedSavedDevice ? buildSavedDevicePrimaryLabel(selectedSavedDevice) : "this device"} from
                          your saved devices? This can&apos;t be undone.
                        </p>
                      </div>
                    )}
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void confirmDeleteSelectedDevice();
                        }}
                      >
                        Delete device
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {status.isConnecting
                  ? "Connecting..."
                  : status.isConnected
                    ? `Connected to ${baseUrl}`
                    : isDemoActive
                      ? `Demo mode — ${baseUrl}`
                      : status.error || "Not connected"}
              </div>
            </motion.div>
          </ProfileSplitSection>

          <ProfileSplitSection minColumnWidth="20rem" testId="settings-middle-layout">
            {/* 3. Diagnostics */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="profile-card bg-card border border-border rounded-xl p-4 space-y-4"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-medium">Diagnostics</h2>
              </div>

              <div className="space-y-4">
                <Button
                  variant="outline"
                  onMouseDownCapture={() => primeDiagnosticsOverlaySuppression()}
                  onPointerDownCapture={() => primeDiagnosticsOverlaySuppression()}
                  onTouchStartCapture={() => primeDiagnosticsOverlaySuppression()}
                  onClick={() => {
                    primeDiagnosticsOverlaySuppression();
                    requestDiagnosticsOpen("settings");
                  }}
                  id="diagnostics-open-dialog"
                  data-diagnostics-open-trigger="true"
                  data-testid="diagnostics-open-dialog"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Diagnostics
                </Button>

                <div className="flex items-start justify-between gap-3 min-w-0">
                  <div className="space-y-1 min-w-0">
                    <Label htmlFor="debug-logging" className="font-medium">
                      Enable Debug Logging
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Emits all debug-level logs for diagnostics, including SAF and REST events.
                    </p>
                  </div>
                  <Checkbox
                    id="debug-logging"
                    checked={debugLoggingEnabled}
                    onCheckedChange={(checked) => {
                      const enabled = checked === true;
                      setDebugLoggingEnabled(enabled);
                      saveDebugLoggingEnabled(enabled);
                    }}
                  />
                </div>

                {debugLoggingEnabled && isAndroid ? (
                  <div className="space-y-2 rounded-lg border border-border/70 p-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">SAF diagnostics</p>
                      <p className="text-xs text-muted-foreground">
                        Manual checks for persisted SAF permissions and enumeration.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void refreshSafPermissions()}
                        disabled={safBusy}
                      >
                        List persisted URIs
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void enumerateSafRoot()}
                        disabled={safBusy || safUris.length === 0}
                      >
                        Enumerate first root
                      </Button>
                    </div>
                    {safError ? <p className="text-xs text-destructive">{safError}</p> : null}
                    {safUris.length ? (
                      <div className="text-xs text-muted-foreground break-words min-w-0">
                        Persisted:{" "}
                        {safUris
                          .map((entry) => redactTreeUri(entry.uri))
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    ) : null}
                    {safEntries.length ? (
                      <div className="max-h-28 overflow-auto whitespace-pre-line break-words min-w-0 text-xs text-muted-foreground">
                        {safEntries.map((entry) => `${entry.type.toUpperCase()}: ${entry.path}`).join("\n")}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-2 rounded-lg border border-border/70 p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Settings transfer</p>
                    <p className="text-xs text-muted-foreground">
                      Export or import non-sensitive settings (connection timing, safety presets, and diagnostics).
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={handleExportSettings}>
                      Export settings
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => settingsFileInputRef.current?.click()}>
                      Import settings
                    </Button>
                  </div>
                  <input
                    ref={settingsFileInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      void handleImportSettings(file);
                      if (event.currentTarget) {
                        event.currentTarget.value = "";
                      }
                    }}
                  />
                </div>
              </div>
            </motion.div>

            {/* 4. Play and Disk */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="profile-card bg-card border border-border rounded-xl p-4 space-y-4"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Play className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-medium">Play and Disk</h2>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="listPreviewLimit" className="text-sm">
                    List preview limit
                  </Label>
                  <Input
                    id="listPreviewLimit"
                    type="number"
                    min={1}
                    max={200}
                    value={listPreviewInput}
                    onChange={(event) => setListPreviewInput(event.target.value)}
                    onBlur={commitListPreviewLimit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitListPreviewLimit();
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Controls how many playlist or disk items are shown before opening View all. Default is 50.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="disk-autostart-mode" className="text-sm">
                    Disk first-PRG load
                  </Label>
                  <Select
                    value={diskAutostartMode}
                    onValueChange={(value) => {
                      const mode = value as DiskAutostartMode;
                      setDiskAutostartMode(mode);
                      saveDiskAutostartMode(mode);
                    }}
                  >
                    <SelectTrigger id="disk-autostart-mode">
                      <SelectValue placeholder="Select load mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kernal">Classic KERNAL load (LOAD"*",8,1)</SelectItem>
                      <SelectItem value="dma">DMA (Direct Memory Access)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Classic KERNAL load mounts the disk and uses LOAD"*",8,1 then RUN. DMA (Direct Memory Access)
                    extracts the first PRG from a D64/D71/D81 image and writes it directly to C64 memory for faster
                    starts. Some loaders may not like DMA.
                  </p>
                </div>
              </div>
            </motion.div>
          </ProfileSplitSection>

          {featureGroups.map((group, index) => (
            <motion.div
              key={group.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 + index * 0.02 }}
              className="bg-card border border-border rounded-xl p-4 space-y-4"
              data-testid={`settings-feature-group-${group.key}`}
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-medium">{group.metadata.label}</h2>
              </div>

              <p className="text-xs text-muted-foreground">{group.metadata.description}</p>

              <div className="space-y-3">
                {group.features.map((feature) => (
                  <div key={feature.id} className="flex items-start justify-between gap-3 min-w-0">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label htmlFor={`feature-flag-${feature.id}`} className="font-medium">
                          {feature.definition.title}
                        </Label>
                        {isDeveloperModeEnabled && feature.definition.developer_only ? (
                          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            Developer only
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{feature.definition.description}</p>
                    </div>
                    <Checkbox
                      id={`feature-flag-${feature.id}`}
                      checked={feature.value}
                      disabled={!feature.editable}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true;
                        void setFlag(feature.id, enabled);
                        if (feature.id === "demo_mode_enabled" && !enabled) {
                          setDemoModeEnabled(false);
                          saveDemoModeEnabled(false);
                          void discoverConnection("settings");
                        }
                      }}
                      data-testid={`feature-flag-${feature.id}`}
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          ))}

          {/* 6. HVSC (hidden when the HVSC feature is disabled for the variant) */}
          {hvscEnabled && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-card border border-border rounded-xl p-4 space-y-4"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-medium">HVSC</h2>
              </div>

              <div className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  HVSC visibility follows the unified feature registry, and the archive mirror can be overridden here
                  when you need to point downloads at a different source.
                </p>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">HVSC base URL override</Label>
                  <Input
                    value={hvscBaseUrlInput}
                    onChange={(event) => setHvscBaseUrlInput(event.target.value)}
                    onBlur={commitHvscBaseUrl}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitHvscBaseUrl();
                    }}
                    placeholder={hvscBaseUrlPreview}
                    data-testid="hvsc-base-url"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the default HVSC mirror. Current base URL: {hvscBaseUrlPreview}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Automatic update check interval (days)</Label>
                  <Input
                    type="number"
                    min={MIN_HVSC_UPDATE_CHECK_INTERVAL_DAYS}
                    step={1}
                    value={hvscUpdateCheckIntervalInput}
                    onChange={(event) => setHvscUpdateCheckIntervalInput(event.target.value)}
                    onBlur={commitHvscUpdateCheckInterval}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitHvscUpdateCheckInterval();
                    }}
                    data-testid="hvsc-update-check-interval"
                  />
                  <p className="text-xs text-muted-foreground">
                    Automatic HVSC update checks run from the Play page when HVSC is installed and ready. The minimum
                    interval is {MIN_HVSC_UPDATE_CHECK_INTERVAL_DAYS} day
                    {MIN_HVSC_UPDATE_CHECK_INTERVAL_DAYS === 1 ? "" : "s"} to avoid unnecessary mirror load.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last automatic update check:{" "}
                    {hvscLastUpdateCheckAt ? new Date(hvscLastUpdateCheckAt).toLocaleString() : "Never"}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* 7. Online Archive (hidden when CommoServe is disabled for the variant) */}
          {commoserveEnabled && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card border border-border rounded-xl p-4 space-y-4"
              data-testid="settings-online-archive"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-medium">Online Archive</h2>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  CommoServe availability now follows the unified Experimental Features registry. Host and header
                  overrides remain independent operational settings.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="archive-host-override" className="text-sm font-medium">
                    Host override
                  </Label>
                  <Input
                    id="archive-host-override"
                    value={archiveHostOverride}
                    onChange={(event) => {
                      const next = event.target.value;
                      setArchiveHostOverride(next);
                      setArchiveHostError(validateArchiveHost(next));
                      saveArchiveHostOverride(next);
                    }}
                    placeholder={resolvedArchiveConfig.host}
                    aria-describedby={archiveHostError ? "archive-host-override-error" : undefined}
                    aria-invalid={archiveHostError ? true : undefined}
                    data-testid="archive-host-override"
                  />
                  {archiveHostError ? (
                    <p id="archive-host-override-error" className="text-xs text-destructive" role="alert">
                      {archiveHostError}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Enter a hostname only. Invalid values fall back to the default archive host immediately.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="archive-client-id-override" className="text-sm font-medium">
                    Client-Id override
                  </Label>
                  <Input
                    id="archive-client-id-override"
                    value={archiveClientIdOverride}
                    onChange={(event) => {
                      const next = event.target.value;
                      setArchiveClientIdOverride(next);
                      saveArchiveClientIdOverride(next);
                    }}
                    placeholder={resolvedArchiveConfig.clientId}
                    data-testid="archive-client-id-override"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="archive-user-agent-override" className="text-sm font-medium">
                    User-Agent override
                  </Label>
                  <Input
                    id="archive-user-agent-override"
                    value={archiveUserAgentOverride}
                    onChange={(event) => {
                      const next = event.target.value;
                      setArchiveUserAgentOverride(next);
                      saveArchiveUserAgentOverride(next);
                    }}
                    placeholder={resolvedArchiveConfig.userAgent}
                    data-testid="archive-user-agent-override"
                  />
                </div>

                <div className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">
                  <div>
                    Resolved host: <span className="font-sans text-foreground">{resolvedArchiveConfig.host}</span>
                  </div>
                  <div>
                    Resolved Client-Id: <span className="text-foreground">{resolvedArchiveConfig.clientId}</span>
                  </div>
                  <div>
                    Resolved User-Agent: <span className="text-foreground">{resolvedArchiveConfig.userAgent}</span>
                  </div>
                  <div className="mt-2">
                    Native apps allow the default cleartext hosts. Override hosts can be blocked by platform security,
                    especially on iOS, until the native allow-list is updated.
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setArchiveDialogOpen(true)}
                  data-testid="open-online-archive"
                >
                  Open archive browser
                </Button>
              </div>
            </motion.div>
          )}

          {/* 8. Device Safety */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-card border border-border rounded-xl p-4 space-y-4"
          >
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Cpu className="h-5 w-5 text-primary" />
              </div>
              <h2 className="font-medium">Device Safety</h2>
            </div>

            {isRelaxedSafetyActive ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                Relaxed safety mode may affect hardware stability.
              </div>
            ) : null}

            <div className="space-y-2">
              <Label className="text-sm font-medium">Safety Mode</Label>
              <Select
                value={deviceSafetyMode}
                onValueChange={(value) => commitDeviceSafetyMode(value as DeviceSafetyMode)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select safety mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Auto (Conservative for C64U, Balanced for others) - recommended</SelectItem>
                  <SelectItem value="RELAXED">Relaxed (lighter throttling, higher risk)</SelectItem>
                  <SelectItem value="BALANCED">Balanced</SelectItem>
                  <SelectItem value="CONSERVATIVE">Conservative (maximum safety)</SelectItem>
                  <SelectItem value="TROUBLESHOOTING">Troubleshooting (low concurrency, extra logging)</SelectItem>
                </SelectContent>
              </Select>
              {autoSafetyDescription ? <p className="text-xs text-muted-foreground">{autoSafetyDescription}</p> : null}
              <p className="text-xs text-muted-foreground">
                Mode presets adjust throttling, caching, cooldowns, and backoff behavior. Troubleshooting mode also
                enables debug logging for richer diagnostics.
              </p>
            </div>

            <div className="rounded-lg border border-border/70 p-3 space-y-4">
              <div className="space-y-1">
                <Label className="font-medium">Network timing</Label>
                <p className="text-xs text-muted-foreground">
                  Tune discovery timing to reduce connection churn or speed up detection.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="startup-discovery-window" className="font-medium">
                  Startup Discovery Window (seconds)
                </Label>
                <Input
                  id="startup-discovery-window"
                  type="number"
                  min={0.5}
                  max={15}
                  step={0.1}
                  value={startupDiscoveryWindowInput}
                  onChange={(event) => setStartupDiscoveryWindowInput(event.target.value)}
                  onBlur={commitStartupDiscoveryWindow}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitStartupDiscoveryWindow();
                  }}
                />
                <p className="text-xs text-muted-foreground">Default 3s. Range 0.5s–15s.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="background-rediscovery-interval" className="font-medium">
                  Background Rediscovery Interval (seconds)
                </Label>
                <Input
                  id="background-rediscovery-interval"
                  type="number"
                  min={1}
                  max={60}
                  step={0.1}
                  value={backgroundRediscoveryIntervalInput}
                  onChange={(event) => setBackgroundRediscoveryIntervalInput(event.target.value)}
                  onBlur={commitBackgroundRediscoveryInterval}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitBackgroundRediscoveryInterval();
                  }}
                />
                <p className="text-xs text-muted-foreground">Default 5s. Range 1s–60s.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="probe-timeout" className="font-medium">
                  Discovery Probe Timeout (seconds)
                </Label>
                <Input
                  id="probe-timeout"
                  type="number"
                  min={0.5}
                  max={10}
                  step={0.1}
                  value={probeTimeoutInput}
                  onChange={(event) => setProbeTimeoutInput(event.target.value)}
                  onBlur={commitProbeTimeout}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitProbeTimeout();
                  }}
                />
                <p className="text-xs text-muted-foreground">Default 2.5s. Range 0.5s–10s.</p>
              </div>
            </div>

            <div className="rounded-lg border border-border/70 p-3 space-y-4">
              <div className="space-y-2">
                <Label className="font-medium">Advanced Controls</Label>
                <p className="text-xs text-muted-foreground">Fine-tuned device protection changes apply immediately.</p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    resetDeviceSafetyOverrides();
                    refreshDeviceSafetyState();
                  }}
                >
                  Reset to mode defaults
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="config-write-interval" className="text-sm">
                  Config write spacing (ms)
                </Label>
                <Input
                  id="config-write-interval"
                  type="number"
                  min={0}
                  max={2000}
                  step={100}
                  value={configWriteIntervalMs}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed)) {
                      setConfigWriteIntervalMs(clampConfigWriteIntervalMs(parsed));
                    }
                  }}
                  onBlur={() => saveConfigWriteIntervalMs(configWriteIntervalMs)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveConfigWriteIntervalMs(configWriteIntervalMs);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum delay between consecutive config write calls. Default {DEFAULT_CONFIG_WRITE_INTERVAL_MS} ms.
                </p>
              </div>

              <div className={profile === "expanded" ? "grid gap-4 grid-cols-2" : "grid gap-4 grid-cols-1"}>
                <div className="space-y-2">
                  <Label htmlFor="ftp-concurrency" className="text-sm">
                    FTP max concurrency
                  </Label>
                  <Input
                    id="ftp-concurrency"
                    type="number"
                    min={1}
                    max={4}
                    step={1}
                    value={ftpConcurrencyInput}
                    onChange={(event) => setFtpConcurrencyInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        ftpConcurrencyInput,
                        saveFtpMaxConcurrency,
                        deviceSafetyConfig.ftpMaxConcurrency,
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rest-concurrency" className="text-sm">
                    Device request concurrency
                  </Label>
                  <Input
                    id="rest-concurrency"
                    type="number"
                    min={1}
                    max={4}
                    step={1}
                    value={restConcurrencyInput}
                    onChange={(event) => setRestConcurrencyInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        restConcurrencyInput,
                        saveRestMaxConcurrency,
                        deviceSafetyConfig.restMaxConcurrency,
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Max simultaneous REST connections to the device. 1 fully serializes requests — safest for firmware
                    without the Ultimate network-stack fixes (e.g. C64U 1.1.0).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="info-cache" className="text-sm">
                    Info cache window (ms)
                  </Label>
                  <Input
                    id="info-cache"
                    type="number"
                    min={0}
                    max={5000}
                    step={50}
                    value={infoCacheInput}
                    onChange={(event) => setInfoCacheInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(infoCacheInput, saveInfoCacheMs, deviceSafetyConfig.infoCacheMs)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="configs-cache" className="text-sm">
                    Configs cache window (ms)
                  </Label>
                  <Input
                    id="configs-cache"
                    type="number"
                    min={0}
                    max={10000}
                    step={50}
                    value={configsCacheInput}
                    onChange={(event) => setConfigsCacheInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(configsCacheInput, saveConfigsCacheMs, deviceSafetyConfig.configsCacheMs)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="configs-cooldown" className="text-sm">
                    Configs cooldown (ms)
                  </Label>
                  <Input
                    id="configs-cooldown"
                    type="number"
                    min={0}
                    max={10000}
                    step={50}
                    value={configsCooldownInput}
                    onChange={(event) => setConfigsCooldownInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        configsCooldownInput,
                        saveConfigsCooldownMs,
                        deviceSafetyConfig.configsCooldownMs,
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="drives-cooldown" className="text-sm">
                    Drives cooldown (ms)
                  </Label>
                  <Input
                    id="drives-cooldown"
                    type="number"
                    min={0}
                    max={10000}
                    step={50}
                    value={drivesCooldownInput}
                    onChange={(event) => setDrivesCooldownInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        drivesCooldownInput,
                        saveDrivesCooldownMs,
                        deviceSafetyConfig.drivesCooldownMs,
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ftp-cooldown" className="text-sm">
                    FTP list cooldown (ms)
                  </Label>
                  <Input
                    id="ftp-cooldown"
                    type="number"
                    min={0}
                    max={10000}
                    step={50}
                    value={ftpCooldownInput}
                    onChange={(event) => setFtpCooldownInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        ftpCooldownInput,
                        saveFtpListCooldownMs,
                        deviceSafetyConfig.ftpListCooldownMs,
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="backoff-base" className="text-sm">
                    Backoff base (ms)
                  </Label>
                  <Input
                    id="backoff-base"
                    type="number"
                    min={0}
                    max={10000}
                    step={50}
                    value={backoffBaseInput}
                    onChange={(event) => setBackoffBaseInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(backoffBaseInput, saveBackoffBaseMs, deviceSafetyConfig.backoffBaseMs)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="backoff-max" className="text-sm">
                    Backoff max (ms)
                  </Label>
                  <Input
                    id="backoff-max"
                    type="number"
                    min={0}
                    max={20000}
                    step={50}
                    value={backoffMaxInput}
                    onChange={(event) => setBackoffMaxInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(backoffMaxInput, saveBackoffMaxMs, deviceSafetyConfig.backoffMaxMs)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="backoff-factor" className="text-sm">
                    Backoff factor
                  </Label>
                  <Input
                    id="backoff-factor"
                    type="number"
                    min={1}
                    max={3}
                    step={0.1}
                    value={backoffFactorInput}
                    onChange={(event) => setBackoffFactorInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(backoffFactorInput, saveBackoffFactor, deviceSafetyConfig.backoffFactor)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="circuit-threshold" className="text-sm">
                    Circuit breaker threshold
                  </Label>
                  <Input
                    id="circuit-threshold"
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={circuitThresholdInput}
                    onChange={(event) => setCircuitThresholdInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        circuitThresholdInput,
                        saveCircuitBreakerThreshold,
                        deviceSafetyConfig.circuitBreakerThreshold,
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="circuit-cooldown" className="text-sm">
                    Circuit breaker cooldown (ms)
                  </Label>
                  <Input
                    id="circuit-cooldown"
                    type="number"
                    min={0}
                    max={20000}
                    step={100}
                    value={circuitCooldownInput}
                    onChange={(event) => setCircuitCooldownInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        circuitCooldownInput,
                        saveCircuitBreakerCooldownMs,
                        deviceSafetyConfig.circuitBreakerCooldownMs,
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="probe-interval" className="text-sm">
                    Discovery probe interval (ms)
                  </Label>
                  <Input
                    id="probe-interval"
                    type="number"
                    min={200}
                    max={2000}
                    step={50}
                    value={probeIntervalInput}
                    onChange={(event) => setProbeIntervalInput(event.target.value)}
                    onBlur={() =>
                      commitDeviceSafetyNumber(
                        probeIntervalInput,
                        saveDiscoveryProbeIntervalMs,
                        deviceSafetyConfig.discoveryProbeIntervalMs,
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="volume-slider-preview-interval" className="text-sm">
                    Slider preview interval (ms)
                  </Label>
                  <Input
                    id="volume-slider-preview-interval"
                    type="number"
                    min={100}
                    max={500}
                    step={10}
                    value={volumeSliderPreviewIntervalMs}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (Number.isFinite(parsed)) {
                        setVolumeSliderPreviewIntervalMs(clampVolumeSliderPreviewIntervalMs(parsed));
                      }
                    }}
                    onBlur={() => saveVolumeSliderPreviewIntervalMs(volumeSliderPreviewIntervalMs)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveVolumeSliderPreviewIntervalMs(volumeSliderPreviewIntervalMs);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Controls how often drag previews are sent while device-backed sliders are moving, including CPU,
                    playback volume, SID mixer, and lighting controls. Default 200 ms. Range 100–500 ms.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Allow circuit override</Label>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-2">
                    <span className="text-xs text-muted-foreground">
                      User-triggered actions can bypass circuit breaker.
                    </span>
                    <Checkbox
                      checked={allowCircuitOverride}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true;
                        setAllowCircuitOverride(enabled);
                        saveAllowUserOverrideCircuit(enabled);
                        refreshDeviceSafetyState();
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Notifications */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38 }}
            className="bg-card border border-border rounded-xl p-4 space-y-4"
          >
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <h2 className="font-medium">Notifications</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="font-medium">Visibility</Label>
                <Select
                  value={notificationVisibility}
                  onValueChange={(value) => {
                    const v = value as NotificationVisibility;
                    setNotificationVisibility(v);
                    saveNotificationVisibility(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="errors-only">Errors only</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Tap a notification to open Diagnostics. Swipe to dismiss.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="font-medium">Duration: {(notificationDurationMs / 1000).toFixed(1)}s</Label>
                <Slider
                  min={NOTIFICATION_DURATION_MIN_MS}
                  max={NOTIFICATION_DURATION_MAX_MS}
                  step={500}
                  value={[notificationDurationMs]}
                  onValueChange={([value]) => {
                    setNotificationDurationMs(value);
                    saveNotificationDurationMs(value);
                  }}
                />
                <p className="text-xs text-muted-foreground">Default 4s. Range 2–8s.</p>
              </div>
            </div>
          </motion.div>

          {/* Last. About */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-card border border-border rounded-xl p-4 space-y-4 cursor-pointer"
            onClick={handleDeveloperTap}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                handleDeveloperTap();
              }
            }}
          >
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Info className="h-5 w-5 text-primary" />
              </div>
              <h2 className="font-medium">About</h2>
            </div>

            <div className="space-y-2 text-sm">
              {buildInfoRows.map((row) => (
                <div key={row.testId} className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-semibold text-right break-words" data-testid={row.testId}>
                    {row.value}
                  </span>
                </div>
              ))}
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">REST API</span>
                <span className="font-semibold">v0.1</span>
              </div>
              {isDeveloperModeEnabled ? (
                <div className="text-xs font-semibold text-success">Developer mode enabled</div>
              ) : null}
            </div>

            <a
              href={settingsDocumentationLink.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
              data-testid={settingsDocumentationLink.testId}
            >
              <ExternalLink className="h-4 w-4" />
              {settingsDocumentationLink.label}
            </a>

            <button
              type="button"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
              onClick={() => navigate("/settings/open-source-licenses")}
            >
              <FileText className="h-4 w-4" />
              Open Source Licenses
            </button>
          </motion.div>
        </PageStack>
      </PageContainer>

      {archiveDialogOpen ? (
        <OnlineArchiveDialog
          open={archiveDialogOpen}
          onOpenChange={setArchiveDialogOpen}
          config={buildDefaultArchiveClientConfig({
            enabled: commoserveEnabled,
            hostOverride: archiveHostOverride,
            clientIdOverride: archiveClientIdOverride,
            userAgentOverride: archiveUserAgentOverride,
          })}
        />
      ) : null}

      <Dialog open={relaxedWarningOpen} onOpenChange={(open) => !open && handleCancelRelaxedMode()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable Relaxed Safety Mode?</DialogTitle>
            <DialogDescription>
              Relaxed mode increases FTP concurrency and reduces protection. This can overload or destabilize real
              hardware. Confirm only if you understand the risks.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelRelaxedMode}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmRelaxedMode}>
              Enable Relaxed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
