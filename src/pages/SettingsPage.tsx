/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Wifi, Moon, Sun, Monitor, Lock, RefreshCw, ExternalLink, Info, FileText, Cpu, Play } from "lucide-react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { C64_DEFAULTS, getDeviceHostFromBaseUrl, resolveDeviceHostFromStorage } from "@/lib/c64api";
import { AppBar } from "@/components/AppBar";
import { useThemeContext } from "@/components/ThemeProvider";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogFooter, DialogHeader, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { addErrorLog, addLog, clearLogs, getErrorLogs, getLogs } from "@/lib/logging";
import { buildActionSummaries } from "@/lib/diagnostics/actionSummaries";
import { clearTraceEvents, getTraceEvents } from "@/lib/tracing/traceSession";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { shareAllDiagnosticsZip, shareDiagnosticsZip } from "@/lib/diagnostics/diagnosticsExport";
import { resetDiagnosticsActivity } from "@/lib/diagnostics/diagnosticsActivity";
import { consumeDiagnosticsOpenRequest, type DiagnosticsTabKey } from "@/lib/diagnostics/diagnosticsOverlay";
import { setDiagnosticsOverlayActive, withDiagnosticsTraceOverride } from "@/lib/diagnostics/diagnosticsOverlayState";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useListPreviewLimit } from "@/hooks/useListPreviewLimit";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { useActionTrace } from "@/hooks/useActionTrace";
import { clampListPreviewLimit } from "@/lib/uiPreferences";
import { getBuildInfo, getBuildInfoRows } from "@/lib/buildInfo";
import { getHvscBaseUrl, getHvscBaseUrlOverride, setHvscBaseUrlOverride } from "@/lib/hvsc/hvscReleaseService";
import {
  clampConfigWriteIntervalMs,
  clampDiscoveryProbeTimeoutMs,
  clampVolumeSliderPreviewIntervalMs,
  loadConfigWriteIntervalMs,
  clampBackgroundRediscoveryIntervalMs,
  clampStartupDiscoveryWindowMs,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadDiscoveryProbeTimeoutMs,
  loadStartupDiscoveryWindowMs,
  loadDebugLoggingEnabled,
  loadDiskAutostartMode,
  loadVolumeSliderPreviewIntervalMs,
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDiscoveryProbeTimeoutMs,
  saveStartupDiscoveryWindowMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiskAutostartMode,
  saveVolumeSliderPreviewIntervalMs,
  type DiskAutostartMode,
} from "@/lib/config/appSettings";
import {
  loadDeviceSafetyConfig,
  saveDeviceSafetyMode,
  saveFtpMaxConcurrency,
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
import { FolderPicker, type SafPersistedUri } from "@/lib/native/folderPicker";
import { getPlatform } from "@/lib/native/platform";
import { redactTreeUri } from "@/lib/native/safUtils";
import { discoverConnection } from "@/lib/connection/connectionManager";
import { useConnectionState } from "@/hooks/useConnectionState";
import { useNavigate } from "react-router-dom";

type Theme = "light" | "dark" | "system";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { status, baseUrl, runtimeBaseUrl, password, deviceHost, updateConfig, refetch } = useC64Connection();
  const connectionSnapshot = useConnectionState();
  const { theme, setTheme } = useThemeContext();
  const { isDeveloperModeEnabled, enableDeveloperMode } = useDeveloperMode();
  const { value: isHvscEnabled, setValue: setHvscEnabled } = useFeatureFlag("hvsc_enabled");
  const { limit: listPreviewLimit, setLimit: setListPreviewLimit } = useListPreviewLimit();
  const trace = useActionTrace("SettingsPage");
  const buildInfo = getBuildInfo();
  const buildInfoRows = getBuildInfoRows(buildInfo);

  const setHvscEnabledAndPersist = (enabled: boolean) => {
    void setHvscEnabled(enabled);
    try {
      localStorage.setItem("c64u_feature_flag:hvsc_enabled", enabled ? "1" : "0");
      sessionStorage.setItem("c64u_feature_flag:hvsc_enabled", enabled ? "1" : "0");
    } catch (error) {
      addErrorLog("Feature flag storage failed", {
        error: (error as Error).message,
      });
    }
  };

  const [passwordInput, setPasswordInput] = useState(password);
  const [deviceHostInput, setDeviceHostInput] = useState(deviceHost);
  const runtimeDeviceHost = getDeviceHostFromBaseUrl(runtimeBaseUrl);
  const isDemoActive = status.state === "DEMO_ACTIVE";
  const lastProbeSucceededAtMs = connectionSnapshot.lastProbeSucceededAtMs;
  const lastProbeFailedAtMs = connectionSnapshot.lastProbeFailedAtMs;
  const [isSaving, setIsSaving] = useState(false);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [diagnosticsTab, setDiagnosticsTab] = useState<DiagnosticsTabKey>("actions");
  const [diagnosticsFilters, setDiagnosticsFilters] = useState<Record<DiagnosticsTabKey, string>>({
    "error-logs": "",
    logs: "",
    traces: "",
    actions: "",
  });
  const [logs, setLogs] = useState(getLogs());
  const [errorLogs, setErrorLogs] = useState(getErrorLogs());
  const [traceEvents, setTraceEvents] = useState(getTraceEvents());
  const actionSummaries = useMemo(() => buildActionSummaries(traceEvents), [traceEvents]);
  const [listPreviewInput, setListPreviewInput] = useState(String(listPreviewLimit));
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(loadDebugLoggingEnabled());
  const [hvscBaseUrlInput, setHvscBaseUrlInput] = useState(() => getHvscBaseUrlOverride() ?? "");
  const [hvscBaseUrlPreview, setHvscBaseUrlPreview] = useState(() => getHvscBaseUrl());
  const [configWriteIntervalMs, setConfigWriteIntervalMs] = useState(loadConfigWriteIntervalMs());
  const [automaticDemoModeEnabled, setAutomaticDemoModeEnabled] = useState(loadAutomaticDemoModeEnabled());
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
  const [safUris, setSafUris] = useState<SafPersistedUri[]>([]);
  const [safEntries, setSafEntries] = useState<Array<{ name: string; path: string; type: string }>>([]);
  const [safBusy, setSafBusy] = useState(false);
  const [safError, setSafError] = useState<string | null>(null);
  const devTapTimestamps = useRef<number[]>([]);
  const settingsFileInputRef = useRef<HTMLInputElement | null>(null);
  const isAndroid = getPlatform() === "android";

  const commitHvscBaseUrl = useCallback(() => {
    const trimmed = hvscBaseUrlInput.trim();
    setHvscBaseUrlOverride(trimmed || null);
    const resolved = getHvscBaseUrl();
    setHvscBaseUrlInput(trimmed ? resolved : "");
    setHvscBaseUrlPreview(resolved);
  }, [hvscBaseUrlInput]);

  const setDiagnosticsDialogOpen = useCallback((open: boolean) => {
    setLogsDialogOpen(open);
    setDiagnosticsOverlayActive(open);
  }, []);

  useEffect(() => {
    setPasswordInput(password);
  }, [password]);

  useEffect(() => {
    if (isDemoActive) {
      setDeviceHostInput(resolveDeviceHostFromStorage());
      return;
    }
    setDeviceHostInput(deviceHost);
  }, [deviceHost, isDemoActive]);

  useEffect(() => {
    setListPreviewInput(String(listPreviewLimit));
  }, [listPreviewLimit]);

  useEffect(() => {
    const handler = () => {
      setLogs(getLogs());
      setErrorLogs(getErrorLogs());
    };
    window.addEventListener("c64u-logs-updated", handler);
    return () => window.removeEventListener("c64u-logs-updated", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setTraceEvents(getTraceEvents());
    };
    window.addEventListener("c64u-traces-updated", handler);
    return () => window.removeEventListener("c64u-traces-updated", handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string; value?: unknown } | undefined;
      if (!detail?.key) return;
      if (detail.key === "c64u_debug_logging_enabled") {
        setDebugLoggingEnabled(Boolean(detail.value));
      }
      if (detail.key === "c64u_config_write_min_interval_ms") {
        setConfigWriteIntervalMs(loadConfigWriteIntervalMs());
      }
      if (detail.key === "c64u_automatic_demo_mode_enabled") {
        setAutomaticDemoModeEnabled(loadAutomaticDemoModeEnabled());
      }
      if (detail.key === "c64u_startup_discovery_window_ms") {
        setStartupDiscoveryWindowInput(String(loadStartupDiscoveryWindowMs() / 1000));
      }
      if (detail.key === "c64u_background_rediscovery_interval_ms") {
        setBackgroundRediscoveryIntervalInput(String(loadBackgroundRediscoveryIntervalMs() / 1000));
      }
      if (detail.key === "c64u_discovery_probe_timeout_ms") {
        setProbeTimeoutInput(String(loadDiscoveryProbeTimeoutMs() / 1000));
      }
      if (detail.key === "c64u_disk_autostart_mode") {
        setDiskAutostartMode(loadDiskAutostartMode());
      }
      if (detail.key === "c64u_volume_slider_preview_interval_ms") {
        setVolumeSliderPreviewIntervalMs(loadVolumeSliderPreviewIntervalMs());
      }
    };
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);

  const refreshDeviceSafetyState = useCallback(() => {
    const next = loadDeviceSafetyConfig();
    setDeviceSafetyConfig(next);
    setDeviceSafetyMode(next.mode);
    setFtpConcurrencyInput(String(next.ftpMaxConcurrency));
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

  useEffect(() => {
    const handleDiagnosticsRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as { tab?: DiagnosticsTabKey } | undefined;
      if (!detail?.tab) return;
      setDiagnosticsTab(detail.tab);
      setDiagnosticsDialogOpen(true);
    };
    const pending = consumeDiagnosticsOpenRequest();
    if (pending) {
      setDiagnosticsTab(pending);
      setDiagnosticsDialogOpen(true);
    }
    window.addEventListener("c64u-diagnostics-open-request", handleDiagnosticsRequest);
    return () => window.removeEventListener("c64u-diagnostics-open-request", handleDiagnosticsRequest);
  }, [setDiagnosticsDialogOpen]);

  useEffect(() => {
    return () => setDiagnosticsOverlayActive(false);
  }, []);

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

  const diagnosticsExportData = useMemo(
    () => ({
      "error-logs": errorLogs,
      logs,
      traces: traceEvents,
      actions: actionSummaries,
    }),
    [actionSummaries, errorLogs, logs, traceEvents],
  );

  const handleShareDiagnostics = trace(async function handleShareDiagnostics() {
    const data = diagnosticsExportData[diagnosticsTab];
    try {
      await shareDiagnosticsZip(diagnosticsTab, data);
    } catch (error) {
      reportUserError({
        operation: "DIAGNOSTICS_EXPORT",
        title: "Unable to share",
        description: (error as Error).message,
        error,
      });
    }
  });

  const handleShareAllDiagnostics = trace(async function handleShareAllDiagnostics() {
    try {
      await shareAllDiagnosticsZip(diagnosticsExportData);
    } catch (error) {
      reportUserError({
        operation: "DIAGNOSTICS_EXPORT",
        title: "Unable to share",
        description: (error as Error).message,
        error,
      });
    }
  });

  const handleClearAllDiagnostics = () => {
    clearLogs();
    clearTraceEvents();
    resetDiagnosticsActivity();
    setLogs([]);
    setErrorLogs([]);
    setTraceEvents([]);
    toast({ title: "Diagnostics cleared" });
  };

  const handleSaveConnection = trace(async function handleSaveConnection() {
    setIsSaving(true);
    try {
      updateConfig(deviceHostInput || C64_DEFAULTS.DEFAULT_DEVICE_HOST, passwordInput || undefined);
      await discoverConnection("settings");
      toast({ title: "Connection settings saved" });
    } catch (error) {
      reportUserError({
        operation: "CONNECTION_SAVE",
        title: "Error",
        description: (error as Error).message,
        error,
      });
    } finally {
      setIsSaving(false);
    }
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
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];

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
    try {
      const payload = exportSettingsJson();
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
  });

  const handleImportSettings = trace(async function handleImportSettings(file?: File | null) {
    if (!file) return;
    try {
      const content = await file.text();
      const result = importSettingsJson(content);
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
      setAutomaticDemoModeEnabled(loadAutomaticDemoModeEnabled());
      setStartupDiscoveryWindowInput(String(loadStartupDiscoveryWindowMs() / 1000));
      setBackgroundRediscoveryIntervalInput(String(loadBackgroundRediscoveryIntervalMs() / 1000));
      setProbeTimeoutInput(String(loadDiscoveryProbeTimeoutMs() / 1000));
      setDiskAutostartMode(loadDiskAutostartMode());
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

  return (
    <div className="min-h-screen pb-24 pt-[var(--app-bar-height)]">
      <AppBar title="Settings" subtitle="Connection & appearance" />

      <main className="container py-6 space-y-6">
        {/* 1. Appearance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.02 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
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
                <button
                  key={option.value}
                  onClick={wrapUserEvent(
                    () => setTheme(option.value),
                    "select",
                    "ThemeSelector",
                    { title: option.label },
                    "ThemeOption",
                  )}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
                >
                  <Icon className={`h-6 w-6 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-sm ${isActive ? "font-medium" : ""}`}>{option.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* 2. Connection Settings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wifi className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-medium">Connection</h2>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="deviceHost" className="text-sm">
                C64U Hostname / IP
              </Label>
              <Input
                id="deviceHost"
                value={deviceHostInput}
                onChange={(e) => setDeviceHostInput(e.target.value)}
                placeholder={C64_DEFAULTS.DEFAULT_DEVICE_HOST}
                className="font-sans"
              />
              <p className="text-xs text-muted-foreground">Hostname or IP from the C64 menu.</p>
              <p className="text-xs text-muted-foreground">
                Currently using: <span className="font-sans break-all">{runtimeDeviceHost}</span>
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
              <Input
                id="password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Optional"
                className="font-sans"
              />
              <p className="text-xs text-muted-foreground">Network password from the C64 manual, if defined</p>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border/70 p-3">
            <div className="flex items-start justify-between gap-3 min-w-0">
              <div className="space-y-1 min-w-0">
                <Label htmlFor="auto-demo-mode" className="font-medium">
                  Automatic Demo Mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  When no hardware is found during discovery, automatically offer Demo Mode for this session.
                </p>
              </div>
              <Checkbox
                id="auto-demo-mode"
                checked={automaticDemoModeEnabled}
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  setAutomaticDemoModeEnabled(enabled);
                  saveAutomaticDemoModeEnabled(enabled);
                }}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSaveConnection} disabled={isSaving} className="flex-1">
              {isSaving ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              Save & Connect
            </Button>
            <Button
              variant="outline"
              onClick={() => void discoverConnection("manual")}
              disabled={status.isConnecting}
              aria-label="Refresh connection"
            >
              <RefreshCw className={`h-4 w-4 ${status.isConnecting ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* Connection Status */}
          <div
            className={`break-words rounded-lg p-3 text-sm ${status.isConnected ? "bg-success/10 text-success" : isDemoActive ? "bg-primary/10 text-primary" : status.isConnecting ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"}`}
          >
            {status.isConnecting
              ? "Connecting..."
              : status.isConnected
                ? `Connected to ${baseUrl}`
                : isDemoActive
                  ? `Demo mode — ${baseUrl}`
                  : status.error || "Not connected"}
          </div>
        </motion.div>

        {/* 3. Diagnostics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
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
              onClick={() => setDiagnosticsDialogOpen(true)}
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
                  <Button variant="outline" size="sm" onClick={() => void refreshSafPermissions()} disabled={safBusy}>
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
          className="bg-card border border-border rounded-xl p-4 space-y-4"
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
              <Label htmlFor="volume-slider-preview-interval" className="text-sm">
                Volume slider preview interval (milliseconds)
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
                Controls how often drag previews are sent while the playback volume slider is moving. Default 200 ms.
                Range 100–500 ms.
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
                Classic KERNAL load mounts the disk and uses LOAD"*",8,1 then RUN. DMA (Direct Memory Access) extracts
                the first PRG from a D64/D71/D81 image and writes it directly to C64 memory for faster starts. Some
                loaders may not like DMA.
              </p>
            </div>
          </div>
        </motion.div>

        {/* 5. Config */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Cpu className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-medium">Config</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 min-w-0">
              <div className="space-y-1 min-w-0">
                <Label htmlFor="auto-demo-mode" className="font-medium">
                  Automatic Demo Mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  When no hardware is found during discovery, automatically offer Demo Mode for this session.
                </p>
              </div>
              <Checkbox
                id="auto-demo-mode"
                checked={automaticDemoModeEnabled}
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  setAutomaticDemoModeEnabled(enabled);
                  saveAutomaticDemoModeEnabled(enabled);
                }}
              />
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
          </div>
        </motion.div>

        {/* 6. HVSC */}
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
            <div className="flex items-start justify-between gap-3 min-w-0">
              <div
                className="space-y-1 min-w-0 cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setHvscEnabledAndPersist(!isHvscEnabled);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setHvscEnabledAndPersist(!isHvscEnabled);
                }}
              >
                <Label htmlFor="hvsc-flag" className="font-medium">
                  Enable HVSC downloads
                </Label>
                <p className="text-xs text-muted-foreground">
                  Shows HVSC download and ingest controls on the Play page.
                </p>
              </div>
              <Checkbox
                id="hvsc-flag"
                aria-label="Enable HVSC downloads"
                data-testid="hvsc-toggle"
                checked={isHvscEnabled}
                onCheckedChange={(checked) => {
                  setHvscEnabledAndPersist(checked === true);
                }}
              />
            </div>
            {isDeveloperModeEnabled ? (
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
            ) : null}
          </div>
        </motion.div>

        {/* 7. Device Safety */}
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

          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            Relaxed safety mode may affect hardware stability.
          </div>

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
                <SelectItem value="RELAXED">Relaxed (lighter throttling, higher risk)</SelectItem>
                <SelectItem value="BALANCED">Balanced (recommended)</SelectItem>
                <SelectItem value="CONSERVATIVE">Conservative (maximum safety)</SelectItem>
                <SelectItem value="TROUBLESHOOTING">Troubleshooting (low concurrency, extra logging)</SelectItem>
              </SelectContent>
            </Select>
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
                Minimum delay between consecutive config write calls. Default 500 ms.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
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
                <Label className="text-sm">Allow user override when circuit is open</Label>
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
            href="https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Ultimate REST API Documentation
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
      </main>

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

      <DiagnosticsDialog
        open={logsDialogOpen}
        onOpenChange={setDiagnosticsDialogOpen}
        diagnosticsTab={diagnosticsTab}
        onDiagnosticsTabChange={setDiagnosticsTab}
        diagnosticsFilters={diagnosticsFilters}
        onDiagnosticsFilterChange={(tab, value) =>
          setDiagnosticsFilters((prev) => ({
            ...prev,
            [tab]: value,
          }))
        }
        logs={logs}
        errorLogs={errorLogs}
        traceEvents={traceEvents}
        actionSummaries={actionSummaries}
        onShareCurrentTab={() => withDiagnosticsTraceOverride(handleShareDiagnostics)}
        onShareAll={() => withDiagnosticsTraceOverride(handleShareAllDiagnostics)}
        onClearAll={handleClearAllDiagnostics}
      />
    </div>
  );
}
