import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
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
  Share2,
  Trash2,
  Cpu,
  Play,
} from 'lucide-react';
import { useC64Connection } from '@/hooks/useC64Connection';
import { C64_DEFAULTS, getDeviceHostFromBaseUrl } from '@/lib/c64api';
import { AppBar } from '@/components/AppBar';
import { useThemeContext } from '@/components/ThemeProvider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { reportUserError } from '@/lib/uiErrors';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addErrorLog, addLog, clearLogs, formatLogsForShare, getErrorLogs, getLogs } from '@/lib/logging';
import { formatLocalTime } from '@/lib/diagnostics/timeFormat';
import { buildActionSummaries, type FtpEffect, type RestEffect } from '@/lib/diagnostics/actionSummaries';
import { clearTraceEvents, getTraceEvents } from '@/lib/tracing/traceSession';
import { shareTraceZip } from '@/lib/tracing/traceExport';
import { getTraceTitle } from '@/lib/tracing/traceFormatter';
import { useDeveloperMode } from '@/hooks/useDeveloperMode';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { wrapUserEvent } from '@/lib/tracing/userTrace';
import { useActionTrace } from '@/hooks/useActionTrace';
import { clampListPreviewLimit } from '@/lib/uiPreferences';
import {
  clampConfigWriteIntervalMs,
  clampDiscoveryProbeTimeoutMs,
  loadConfigWriteIntervalMs,
  clampBackgroundRediscoveryIntervalMs,
  clampStartupDiscoveryWindowMs,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadDiscoveryProbeTimeoutMs,
  loadStartupDiscoveryWindowMs,
  loadDebugLoggingEnabled,
  loadDiskAutostartMode,
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDiscoveryProbeTimeoutMs,
  saveStartupDiscoveryWindowMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiskAutostartMode,
  type DiskAutostartMode,
} from '@/lib/config/appSettings';
import {
  loadDeviceSafetyConfig,
  saveDeviceSafetyMode,
  saveRestMaxConcurrency,
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
} from '@/lib/config/deviceSafetySettings';
import { exportSettingsJson, importSettingsJson } from '@/lib/config/settingsTransfer';
import { FolderPicker, type SafPersistedUri } from '@/lib/native/folderPicker';
import { getPlatform } from '@/lib/native/platform';
import { redactTreeUri } from '@/lib/native/safUtils';
import { dismissDemoInterstitial, discoverConnection } from '@/lib/connection/connectionManager';
import { useConnectionState } from '@/hooks/useConnectionState';
import {
  clearFtpBridgeUrl,
  clearStoredFtpPort,
  getFtpBridgeUrl,
  getStoredFtpPort,
  setFtpBridgeUrl,
  setStoredFtpPort,
} from '@/lib/ftp/ftpConfig';

type Theme = 'light' | 'dark' | 'system';

export default function SettingsPage() {
  const { status, baseUrl, runtimeBaseUrl, password, deviceHost, updateConfig, refetch } = useC64Connection();
  const connectionSnapshot = useConnectionState();
  const { theme, setTheme } = useThemeContext();
  const { isDeveloperModeEnabled, enableDeveloperMode } = useDeveloperMode();
  const { value: isHvscEnabled, setValue: setHvscEnabled } = useFeatureFlag('hvsc_enabled');
  const { limit: listPreviewLimit, setLimit: setListPreviewLimit } = useListPreviewLimit();
  const trace = useActionTrace('SettingsPage');

  const setHvscEnabledAndPersist = (enabled: boolean) => {
    void setHvscEnabled(enabled);
    try {
      localStorage.setItem('c64u_feature_flag:hvsc_enabled', enabled ? '1' : '0');
      sessionStorage.setItem('c64u_feature_flag:hvsc_enabled', enabled ? '1' : '0');
    } catch (error) {
      addErrorLog('Feature flag storage failed', {
        error: (error as Error).message,
      });
    }
  };
  
  const [passwordInput, setPasswordInput] = useState(password);
  const [deviceHostInput, setDeviceHostInput] = useState(deviceHost);
  const runtimeDeviceHost = getDeviceHostFromBaseUrl(runtimeBaseUrl);
  const isDemoActive = status.state === 'DEMO_ACTIVE';
  const lastProbeSucceededAtMs = connectionSnapshot.lastProbeSucceededAtMs;
  const lastProbeFailedAtMs = connectionSnapshot.lastProbeFailedAtMs;
  const [isSaving, setIsSaving] = useState(false);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [diagnosticsTab, setDiagnosticsTab] = useState<'errors' | 'logs' | 'traces' | 'actions'>('errors');
  const [logs, setLogs] = useState(getLogs());
  const [errorLogs, setErrorLogs] = useState(getErrorLogs());
  const [traceEvents, setTraceEvents] = useState(getTraceEvents());
  const actionSummaries = useMemo(() => buildActionSummaries(traceEvents), [traceEvents]);
  const [listPreviewInput, setListPreviewInput] = useState(String(listPreviewLimit));
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(loadDebugLoggingEnabled());
  const [configWriteIntervalMs, setConfigWriteIntervalMs] = useState(loadConfigWriteIntervalMs());
  const [automaticDemoModeEnabled, setAutomaticDemoModeEnabled] = useState(loadAutomaticDemoModeEnabled());
  const [diskAutostartMode, setDiskAutostartMode] = useState<DiskAutostartMode>(loadDiskAutostartMode());
  const [startupDiscoveryWindowInput, setStartupDiscoveryWindowInput] = useState(
    String(loadStartupDiscoveryWindowMs() / 1000),
  );
  const [backgroundRediscoveryIntervalInput, setBackgroundRediscoveryIntervalInput] = useState(
    String(loadBackgroundRediscoveryIntervalMs() / 1000),
  );
  const [probeTimeoutInput, setProbeTimeoutInput] = useState(
    String(loadDiscoveryProbeTimeoutMs() / 1000),
  );
  const [deviceSafetyConfig, setDeviceSafetyConfig] = useState(() => loadDeviceSafetyConfig());
  const [deviceSafetyMode, setDeviceSafetyMode] = useState<DeviceSafetyMode>(deviceSafetyConfig.mode);
  const [pendingSafetyMode, setPendingSafetyMode] = useState<DeviceSafetyMode | null>(null);
  const [relaxedWarningOpen, setRelaxedWarningOpen] = useState(false);
  const [restConcurrencyInput, setRestConcurrencyInput] = useState(String(deviceSafetyConfig.restMaxConcurrency));
  const [ftpConcurrencyInput, setFtpConcurrencyInput] = useState(String(deviceSafetyConfig.ftpMaxConcurrency));
  const [infoCacheInput, setInfoCacheInput] = useState(String(deviceSafetyConfig.infoCacheMs));
  const [configsCacheInput, setConfigsCacheInput] = useState(String(deviceSafetyConfig.configsCacheMs));
  const [configsCooldownInput, setConfigsCooldownInput] = useState(String(deviceSafetyConfig.configsCooldownMs));
  const [drivesCooldownInput, setDrivesCooldownInput] = useState(String(deviceSafetyConfig.drivesCooldownMs));
  const [ftpCooldownInput, setFtpCooldownInput] = useState(String(deviceSafetyConfig.ftpListCooldownMs));
  const [backoffBaseInput, setBackoffBaseInput] = useState(String(deviceSafetyConfig.backoffBaseMs));
  const [backoffMaxInput, setBackoffMaxInput] = useState(String(deviceSafetyConfig.backoffMaxMs));
  const [backoffFactorInput, setBackoffFactorInput] = useState(String(deviceSafetyConfig.backoffFactor));
  const [circuitThresholdInput, setCircuitThresholdInput] = useState(String(deviceSafetyConfig.circuitBreakerThreshold));
  const [circuitCooldownInput, setCircuitCooldownInput] = useState(String(deviceSafetyConfig.circuitBreakerCooldownMs));
  const [probeIntervalInput, setProbeIntervalInput] = useState(String(deviceSafetyConfig.discoveryProbeIntervalMs));
  const [allowCircuitOverride, setAllowCircuitOverride] = useState(deviceSafetyConfig.allowUserOverrideCircuit);
  const [safUris, setSafUris] = useState<SafPersistedUri[]>([]);
  const [safEntries, setSafEntries] = useState<Array<{ name: string; path: string; type: string }>>([]);
  const [safBusy, setSafBusy] = useState(false);
  const [safError, setSafError] = useState<string | null>(null);
  const devTapTimestamps = useRef<number[]>([]);
  const settingsFileInputRef = useRef<HTMLInputElement | null>(null);
  const isAndroid = getPlatform() === 'android';
  const [ftpPortInput, setFtpPortInput] = useState(String(getStoredFtpPort()));
  const [ftpBridgeUrlInput, setFtpBridgeUrlInput] = useState(getFtpBridgeUrl());

  useEffect(() => {
    setPasswordInput(password);
  }, [password]);

  useEffect(() => {
    setDeviceHostInput(deviceHost);
  }, [deviceHost]);

  useEffect(() => {
    dismissDemoInterstitial();
  }, []);

  useEffect(() => {
    setListPreviewInput(String(listPreviewLimit));
  }, [listPreviewLimit]);

  useEffect(() => {
    const handler = () => {
      setLogs(getLogs());
      setErrorLogs(getErrorLogs());
    };
    window.addEventListener('c64u-logs-updated', handler);
    return () => window.removeEventListener('c64u-logs-updated', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setTraceEvents(getTraceEvents());
    };
    window.addEventListener('c64u-traces-updated', handler);
    return () => window.removeEventListener('c64u-traces-updated', handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string; value?: unknown } | undefined;
      if (!detail?.key) return;
      if (detail.key === 'c64u_debug_logging_enabled') {
        setDebugLoggingEnabled(Boolean(detail.value));
      }
      if (detail.key === 'c64u_config_write_min_interval_ms') {
        setConfigWriteIntervalMs(loadConfigWriteIntervalMs());
      }
      if (detail.key === 'c64u_automatic_demo_mode_enabled') {
        setAutomaticDemoModeEnabled(loadAutomaticDemoModeEnabled());
      }
      if (detail.key === 'c64u_startup_discovery_window_ms') {
        setStartupDiscoveryWindowInput(String(loadStartupDiscoveryWindowMs() / 1000));
      }
      if (detail.key === 'c64u_background_rediscovery_interval_ms') {
        setBackgroundRediscoveryIntervalInput(String(loadBackgroundRediscoveryIntervalMs() / 1000));
      }
      if (detail.key === 'c64u_discovery_probe_timeout_ms') {
        setProbeTimeoutInput(String(loadDiscoveryProbeTimeoutMs() / 1000));
      }
      if (detail.key === 'c64u_disk_autostart_mode') {
        setDiskAutostartMode(loadDiskAutostartMode());
      }
    };
    window.addEventListener('c64u-app-settings-updated', handler);
    return () => window.removeEventListener('c64u-app-settings-updated', handler);
  }, []);

  const refreshDeviceSafetyState = useCallback(() => {
    const next = loadDeviceSafetyConfig();
    setDeviceSafetyConfig(next);
    setDeviceSafetyMode(next.mode);
    setRestConcurrencyInput(String(next.restMaxConcurrency));
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
    window.addEventListener('c64u-device-safety-updated', handler);
    return () => window.removeEventListener('c64u-device-safety-updated', handler);
  }, [refreshDeviceSafetyState]);

  const logsPayload = useMemo(() => formatLogsForShare(logs), [logs]);
  const logsRedactedPayload = useMemo(() => formatLogsForShare(logs, { redacted: true }), [logs]);
  const errorsPayload = useMemo(() => formatLogsForShare(errorLogs), [errorLogs]);
  const errorsRedactedPayload = useMemo(() => formatLogsForShare(errorLogs, { redacted: true }), [errorLogs]);
  const resolveLogPayload = useCallback(
    (redacted: boolean) => {
      if (diagnosticsTab === 'errors') {
        return redacted ? errorsRedactedPayload : errorsPayload;
      }
      return redacted ? logsRedactedPayload : logsPayload;
    },
    [diagnosticsTab, errorsPayload, errorsRedactedPayload, logsPayload, logsRedactedPayload],
  );

  const refreshSafPermissions = async () => {
    if (!isAndroid) return;
    setSafBusy(true);
    setSafError(null);
    try {
      const result = await FolderPicker.getPersistedUris();
      setSafUris(result?.uris ?? []);
      addLog('debug', 'SAF persisted URIs (manual)', {
        count: result?.uris?.length ?? 0,
        uris: (result?.uris ?? []).map((entry) => redactTreeUri(entry.uri)),
      });
    } catch (error) {
      const message = (error as Error).message;
      setSafError(message);
      addErrorLog('SAF persisted URI lookup failed', { error: message });
    } finally {
      setSafBusy(false);
    }
  };

  const enumerateSafRoot = async () => {
    if (!isAndroid) return;
    const treeUri = safUris[0]?.uri;
    if (!treeUri) {
      reportUserError({
        operation: 'SAF_DIAGNOSTICS',
        title: 'SAF diagnostics',
        description: 'No persisted SAF permissions found.',
      });
      return;
    }
    setSafBusy(true);
    setSafError(null);
    try {
      const result = await FolderPicker.listChildren({ treeUri, path: '/' });
      setSafEntries(result.entries ?? []);
      addLog('debug', 'SAF diagnostic enumeration', {
        treeUri: redactTreeUri(treeUri),
        entries: result.entries?.length ?? 0,
      });
    } catch (error) {
      const message = (error as Error).message;
      setSafError(message);
      addErrorLog('SAF enumeration failed', { error: message });
    } finally {
      setSafBusy(false);
    }
  };

  const handleShareLogs = trace(async function handleShareLogs(redacted: boolean) {
    const label = diagnosticsTab === 'errors' ? 'errors' : 'logs';
    const content = resolveLogPayload(redacted) || 'No entries recorded.';
    try {
      if (navigator.share) {
        await navigator.share({
          title: `C64 Commander ${redacted ? 'redacted ' : ''}${label}`,
          text: content,
        });
        return;
      }
    } catch (error) {
      addErrorLog('Share failed', { error: (error as Error).message });
    }

    try {
      await navigator.clipboard.writeText(content);
      toast({ title: `Copied ${redacted ? 'redacted ' : ''}${label} to clipboard` });
    } catch (error) {
      reportUserError({
        operation: 'LOG_SHARE',
        title: 'Unable to share',
        description: (error as Error).message,
        error,
      });
    }
  });

  const handleEmailLogs = trace(function handleEmailLogs(redacted: boolean) {
    const label = diagnosticsTab === 'errors' ? 'errors' : 'logs';
    const address = ['apps', 'gleissner.uk'].join('@');
    const subject = encodeURIComponent('C64 Commander diagnostics');
    const body = encodeURIComponent(resolveLogPayload(redacted) || 'No entries recorded.');
    window.location.href = `mailto:${address}?subject=${subject}&body=${body}`;
    addLog('info', 'Diagnostics email prepared', { redacted, label });
  });

  const handleExportTraces = trace(async function handleExportTraces(redacted: boolean) {
    try {
      await shareTraceZip('c64commander-traces.zip', { redacted });
    } catch (error) {
      reportUserError({
        operation: 'TRACE_EXPORT',
        title: 'Error',
        description: (error as Error).message,
        error,
      });
    }
  });

  const handleSaveConnection = trace(async function handleSaveConnection() {
    setIsSaving(true);
    try {
      updateConfig(deviceHostInput || C64_DEFAULTS.DEFAULT_DEVICE_HOST, passwordInput || undefined);
      await discoverConnection('settings');
      toast({ title: 'Connection settings saved' });
    } catch (error) {
      reportUserError({
        operation: 'CONNECTION_SAVE',
        title: 'Error',
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
      toast({ title: 'Developer mode enabled' });
    }
  };

  const themeOptions: { value: Theme; icon: React.ElementType; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
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

  const commitFtpPort = () => {
    const parsed = Number(ftpPortInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      clearStoredFtpPort();
      setFtpPortInput(String(getStoredFtpPort()));
      return;
    }
    setStoredFtpPort(Math.round(parsed));
    setFtpPortInput(String(getStoredFtpPort()));
  };

  const commitFtpBridgeUrl = () => {
    const trimmed = ftpBridgeUrlInput.trim();
    if (!trimmed) {
      clearFtpBridgeUrl();
      setFtpBridgeUrlInput(getFtpBridgeUrl());
      return;
    }
    setFtpBridgeUrl(trimmed);
    setFtpBridgeUrlInput(getFtpBridgeUrl());
  };

  const commitDeviceSafetyMode = (mode: DeviceSafetyMode) => {
    if (mode === 'RELAXED' && deviceSafetyMode !== 'RELAXED') {
      setPendingSafetyMode(mode);
      setRelaxedWarningOpen(true);
      return;
    }
    saveDeviceSafetyMode(mode);
    if (mode === 'TROUBLESHOOTING') {
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

  const logExportLabel = diagnosticsTab === 'errors' ? 'errors' : 'logs';
  const isLogTab = diagnosticsTab === 'errors' || diagnosticsTab === 'logs';

  const handleConfirmRelaxedMode = () => {
    if (pendingSafetyMode !== 'RELAXED') {
      setRelaxedWarningOpen(false);
      setPendingSafetyMode(null);
      return;
    }
    saveDeviceSafetyMode('RELAXED');
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
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'c64commander-settings.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast({ title: 'Settings export ready' });
    } catch (error) {
      reportUserError({
        operation: 'SETTINGS_EXPORT',
        title: 'Settings export failed',
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
          operation: 'SETTINGS_IMPORT',
          title: 'Settings import failed',
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
      toast({ title: 'Settings imported' });
    } catch (error) {
      reportUserError({
        operation: 'SETTINGS_IMPORT',
        title: 'Settings import failed',
        description: (error as Error).message,
        error,
      });
    }
  });

  return (
    <div className="min-h-screen pb-24">
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
                  onClick={wrapUserEvent(() => setTheme(option.value), 'select', 'ThemeSelector', { title: option.label }, 'ThemeOption')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors ${
                    isActive 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:border-muted-foreground'
                  }`}
                >
                  <Icon className={`h-6 w-6 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-sm ${isActive ? 'font-medium' : ''}`}>
                    {option.label}
                  </span>
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
              <Label htmlFor="deviceHost" className="text-sm">C64U Hostname / IP</Label>
              <Input
                id="deviceHost"
                value={deviceHostInput}
                onChange={(e) => setDeviceHostInput(e.target.value)}
                placeholder={C64_DEFAULTS.DEFAULT_DEVICE_HOST}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Hostname or IP from the C64 menu.
              </p>
              <p className="text-xs text-muted-foreground">
                Currently using: <span className="font-mono break-all">{runtimeDeviceHost}</span>
                {isDemoActive ? ' (Demo mock)' : ''}
              </p>
              {isDemoActive ? (
                <p className="text-xs text-muted-foreground">
                  {lastProbeSucceededAtMs
                    ? 'Real device detected during probe.'
                    : lastProbeFailedAtMs
                      ? 'No real device detected in recent probe.'
                      : 'Waiting for initial probe.'}
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
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Network password from the C64 manual, if defined
              </p>
            </div>

          </div>

          <div className="space-y-4 rounded-lg border border-border/70 p-3">
            <div className="flex items-start justify-between gap-3 min-w-0">
              <div className="space-y-1 min-w-0">
                <Label htmlFor="auto-demo-mode" className="font-medium">Automatic Demo Mode</Label>
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

          <div className="space-y-4 rounded-lg border border-border/70 p-3">
            <div className="space-y-1">
              <Label className="font-medium">FTP Connection</Label>
              <p className="text-xs text-muted-foreground">
                Override FTP port or bridge URL when troubleshooting non-standard setups.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ftp-port" className="text-sm">FTP port</Label>
                <Input
                  id="ftp-port"
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  value={ftpPortInput}
                  onChange={(event) => setFtpPortInput(event.target.value)}
                  onBlur={commitFtpPort}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitFtpPort();
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ftp-bridge-url" className="text-sm">FTP bridge URL</Label>
                <Input
                  id="ftp-bridge-url"
                  value={ftpBridgeUrlInput}
                  onChange={(event) => setFtpBridgeUrlInput(event.target.value)}
                  onBlur={commitFtpBridgeUrl}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitFtpBridgeUrl();
                  }}
                  placeholder="https://bridge.example"
                  className="font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSaveConnection}
              disabled={isSaving}
              className="flex-1"
            >
              {isSaving ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save & Connect
            </Button>
            <Button
              variant="outline"
              onClick={() => void discoverConnection('manual')}
              disabled={status.isConnecting}
              aria-label="Refresh connection"
            >
              <RefreshCw className={`h-4 w-4 ${status.isConnecting ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Connection Status */}
          <div className={`p-3 rounded-lg text-sm break-words ${
            status.isConnected 
              ? 'bg-success/10 text-success' 
              : status.isConnecting
                ? 'bg-muted text-muted-foreground'
                : 'bg-destructive/10 text-destructive'
          }`}>
            {status.isConnecting ? (
              'Connecting...'
            ) : status.isConnected ? (
              `Connected to ${baseUrl}`
            ) : (
              status.error || 'Not connected'
            )}
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
            <Button variant="outline" onClick={() => setLogsDialogOpen(true)}>
              <FileText className="h-4 w-4 mr-2" />
              Logs and Traces
            </Button>

            <div className="flex items-start justify-between gap-3 min-w-0">
              <div className="space-y-1 min-w-0">
                <Label htmlFor="debug-logging" className="font-medium">Enable Debug Logging</Label>
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
                {safError ? (
                  <p className="text-xs text-destructive">{safError}</p>
                ) : null}
                {safUris.length ? (
                  <div className="text-xs text-muted-foreground break-words min-w-0">
                    Persisted: {safUris.map((entry) => redactTreeUri(entry.uri)).filter(Boolean).join(', ')}
                  </div>
                ) : null}
                {safEntries.length ? (
                  <div className="max-h-28 overflow-auto whitespace-pre-line break-words min-w-0 text-xs text-muted-foreground">
                    {safEntries.map((entry) => `${entry.type.toUpperCase()}: ${entry.path}`).join('\n')}
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => settingsFileInputRef.current?.click()}
                >
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
                    event.currentTarget.value = '';
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="config-write-interval" className="font-medium">
                  Config write spacing
                </Label>
                <span className="text-xs text-muted-foreground">{configWriteIntervalMs} ms</span>
              </div>
              <Slider
                id="config-write-interval"
                min={0}
                max={2000}
                step={100}
                value={[configWriteIntervalMs]}
                onValueChange={(value) => setConfigWriteIntervalMs(clampConfigWriteIntervalMs(value[0] ?? 0))}
                onValueCommit={(value) => saveConfigWriteIntervalMs(value[0] ?? 0)}
              />
              <p className="text-xs text-muted-foreground">
                Minimum delay between consecutive config write calls. Default 500 ms.
              </p>
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
                  if (event.key === 'Enter') {
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
                <Label htmlFor="auto-demo-mode" className="font-medium">Automatic Demo Mode</Label>
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
              <Label htmlFor="startup-discovery-window" className="font-medium">Startup Discovery Window (seconds)</Label>
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
                  if (event.key === 'Enter') commitStartupDiscoveryWindow();
                }}
              />
              <p className="text-xs text-muted-foreground">Default 3s. Range 0.5s–15s.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="background-rediscovery-interval" className="font-medium">Background Rediscovery Interval (seconds)</Label>
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
                  if (event.key === 'Enter') commitBackgroundRediscoveryInterval();
                }}
              />
              <p className="text-xs text-muted-foreground">Default 5s. Range 1s–60s.</p>
            </div>
          </div>
        </motion.div>

        {/* 6. HVSC Library */}
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
            <h2 className="font-medium">HVSC Library</h2>
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
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  setHvscEnabledAndPersist(!isHvscEnabled);
                }}
              >
                <Label htmlFor="hvsc-flag" className="font-medium">
                  Enable HVSC downloads
                </Label>
                <p className="text-xs text-muted-foreground">Shows HVSC download and ingest controls on the Play page.</p>
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
          </div>
        </motion.div>

        {/* 7. About */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4 cursor-pointer"
          onClick={handleDeveloperTap}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
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
            <div className="flex justify-between">
              <span className="text-muted-foreground">App Version</span>
              <span className="font-mono">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">REST API</span>
              <span className="font-mono">v0.1</span>
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
        </motion.div>

        {/* Last. Device Safety */}
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
            Lower safety settings can overwhelm or destabilize real hardware. Use relaxed settings only if you
            understand the risks and are willing to accept potential device instability.
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
                <SelectItem value="RELAXED">Relaxed (higher concurrency, higher risk)</SelectItem>
                <SelectItem value="BALANCED">Balanced (recommended)</SelectItem>
                <SelectItem value="CONSERVATIVE">Conservative (maximum safety)</SelectItem>
                <SelectItem value="TROUBLESHOOTING">Troubleshooting (low concurrency, extra logging)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Mode presets adjust concurrency limits, caching, cooldowns, and backoff behavior.
              Troubleshooting mode also enables debug logging for richer diagnostics.
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
              <Label htmlFor="startup-discovery-window" className="font-medium">Startup Discovery Window (seconds)</Label>
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
                  if (event.key === 'Enter') commitStartupDiscoveryWindow();
                }}
              />
              <p className="text-xs text-muted-foreground">Default 3s. Range 0.5s–15s.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="background-rediscovery-interval" className="font-medium">Background Rediscovery Interval (seconds)</Label>
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
                  if (event.key === 'Enter') commitBackgroundRediscoveryInterval();
                }}
              />
              <p className="text-xs text-muted-foreground">Default 5s. Range 1s–60s.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="probe-timeout" className="font-medium">Discovery Probe Timeout (seconds)</Label>
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
                  if (event.key === 'Enter') commitProbeTimeout();
                }}
              />
              <p className="text-xs text-muted-foreground">Default 2.5s. Range 0.5s–10s.</p>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 p-3 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <Label className="font-medium">Advanced Controls</Label>
                <p className="text-xs text-muted-foreground">
                  Fine-tune device protection. Changes apply immediately.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetDeviceSafetyOverrides();
                  refreshDeviceSafetyState();
                }}
              >
                Reset to mode defaults
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rest-concurrency" className="text-sm">REST max concurrency</Label>
                <Input
                  id="rest-concurrency"
                  type="number"
                  min={1}
                  max={4}
                  step={1}
                  value={restConcurrencyInput}
                  onChange={(event) => setRestConcurrencyInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(restConcurrencyInput, saveRestMaxConcurrency, deviceSafetyConfig.restMaxConcurrency)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ftp-concurrency" className="text-sm">FTP max concurrency</Label>
                <Input
                  id="ftp-concurrency"
                  type="number"
                  min={1}
                  max={4}
                  step={1}
                  value={ftpConcurrencyInput}
                  onChange={(event) => setFtpConcurrencyInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(ftpConcurrencyInput, saveFtpMaxConcurrency, deviceSafetyConfig.ftpMaxConcurrency)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="info-cache" className="text-sm">Info cache window (ms)</Label>
                <Input
                  id="info-cache"
                  type="number"
                  min={0}
                  max={5000}
                  step={50}
                  value={infoCacheInput}
                  onChange={(event) => setInfoCacheInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(infoCacheInput, saveInfoCacheMs, deviceSafetyConfig.infoCacheMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="configs-cache" className="text-sm">Configs cache window (ms)</Label>
                <Input
                  id="configs-cache"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={configsCacheInput}
                  onChange={(event) => setConfigsCacheInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(configsCacheInput, saveConfigsCacheMs, deviceSafetyConfig.configsCacheMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="configs-cooldown" className="text-sm">Configs cooldown (ms)</Label>
                <Input
                  id="configs-cooldown"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={configsCooldownInput}
                  onChange={(event) => setConfigsCooldownInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(configsCooldownInput, saveConfigsCooldownMs, deviceSafetyConfig.configsCooldownMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="drives-cooldown" className="text-sm">Drives cooldown (ms)</Label>
                <Input
                  id="drives-cooldown"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={drivesCooldownInput}
                  onChange={(event) => setDrivesCooldownInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(drivesCooldownInput, saveDrivesCooldownMs, deviceSafetyConfig.drivesCooldownMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ftp-cooldown" className="text-sm">FTP list cooldown (ms)</Label>
                <Input
                  id="ftp-cooldown"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={ftpCooldownInput}
                  onChange={(event) => setFtpCooldownInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(ftpCooldownInput, saveFtpListCooldownMs, deviceSafetyConfig.ftpListCooldownMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="backoff-base" className="text-sm">Backoff base (ms)</Label>
                <Input
                  id="backoff-base"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={backoffBaseInput}
                  onChange={(event) => setBackoffBaseInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(backoffBaseInput, saveBackoffBaseMs, deviceSafetyConfig.backoffBaseMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="backoff-max" className="text-sm">Backoff max (ms)</Label>
                <Input
                  id="backoff-max"
                  type="number"
                  min={0}
                  max={20000}
                  step={50}
                  value={backoffMaxInput}
                  onChange={(event) => setBackoffMaxInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(backoffMaxInput, saveBackoffMaxMs, deviceSafetyConfig.backoffMaxMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="backoff-factor" className="text-sm">Backoff factor</Label>
                <Input
                  id="backoff-factor"
                  type="number"
                  min={1}
                  max={3}
                  step={0.1}
                  value={backoffFactorInput}
                  onChange={(event) => setBackoffFactorInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(backoffFactorInput, saveBackoffFactor, deviceSafetyConfig.backoffFactor)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="circuit-threshold" className="text-sm">Circuit breaker threshold</Label>
                <Input
                  id="circuit-threshold"
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  value={circuitThresholdInput}
                  onChange={(event) => setCircuitThresholdInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(circuitThresholdInput, saveCircuitBreakerThreshold, deviceSafetyConfig.circuitBreakerThreshold)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="circuit-cooldown" className="text-sm">Circuit breaker cooldown (ms)</Label>
                <Input
                  id="circuit-cooldown"
                  type="number"
                  min={0}
                  max={20000}
                  step={100}
                  value={circuitCooldownInput}
                  onChange={(event) => setCircuitCooldownInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(circuitCooldownInput, saveCircuitBreakerCooldownMs, deviceSafetyConfig.circuitBreakerCooldownMs)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="probe-interval" className="text-sm">Discovery probe interval (ms)</Label>
                <Input
                  id="probe-interval"
                  type="number"
                  min={200}
                  max={2000}
                  step={50}
                  value={probeIntervalInput}
                  onChange={(event) => setProbeIntervalInput(event.target.value)}
                  onBlur={() => commitDeviceSafetyNumber(probeIntervalInput, saveDiscoveryProbeIntervalMs, deviceSafetyConfig.discoveryProbeIntervalMs)}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Allow user override when circuit is open</Label>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-2">
                  <span className="text-xs text-muted-foreground">User-triggered actions can bypass circuit breaker.</span>
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
      </main>

      <Dialog open={relaxedWarningOpen} onOpenChange={(open) => !open && handleCancelRelaxedMode()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable Relaxed Safety Mode?</DialogTitle>
            <DialogDescription>
              Relaxed mode increases concurrency and reduces protection. This can overload or destabilize real
              hardware. Confirm only if you understand the risks.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelRelaxedMode}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmRelaxedMode}>Enable Relaxed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Diagnostics</DialogTitle>
            <DialogDescription>Review logs, errors, traces, and action summaries. Choose raw or redacted exports.</DialogDescription>
          </DialogHeader>
          <Tabs
            value={diagnosticsTab}
            onValueChange={(value) => setDiagnosticsTab(value as 'errors' | 'logs' | 'traces' | 'actions')}
            className="space-y-3"
          >
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="errors">Errors</TabsTrigger>
              <TabsTrigger value="logs">All logs</TabsTrigger>
              <TabsTrigger value="traces">Traces</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>
            <TabsContent value="errors" className="space-y-2 max-h-[calc(100dvh-22rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
              {errorLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No errors recorded.</p>
              ) : (
                errorLogs.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{entry.message}</p>
                    <p className="text-xs text-muted-foreground">{formatLocalTime(entry.timestamp)}</p>
                    {entry.details && (
                      <pre className="mt-2 text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </TabsContent>
            <TabsContent value="logs" className="space-y-2 max-h-[calc(100dvh-22rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No logs recorded.</p>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{entry.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.level.toUpperCase()} · {formatLocalTime(entry.timestamp)}
                    </p>
                    {entry.details && (
                      <pre className="mt-2 text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </TabsContent>
            <TabsContent value="traces" className="space-y-3 max-h-[calc(100dvh-22rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await Promise.resolve(clearTraceEvents());
                    setTraceEvents([]);
                    toast({ title: 'Traces cleared' });
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear traces
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleExportTraces(false)}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share / Export
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleExportTraces(true)}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share Redacted
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Total traces: {traceEvents.length}</p>
              {traceEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No traces recorded.</p>
              ) : (
                <>
                  {traceEvents.length > 100 && (
                    <p className="text-xs text-muted-foreground font-medium text-amber-600">
                      Showing last 100 events. Export for full history.
                    </p>
                  )}
                  {traceEvents
                    .slice(-100)
                    .reverse()
                    .map((entry) => (
                      <details key={entry.id} className="rounded-lg border border-border p-3">
                        <summary className="cursor-pointer text-sm font-medium flex justify-between items-center select-none">
                          <span>{getTraceTitle(entry)}</span>
                          <span className="text-muted-foreground font-mono text-xs ml-2 shrink-0">
                            {formatLocalTime(entry.timestamp)}
                          </span>
                        </summary>
                        <pre className="mt-2 text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                          {JSON.stringify(entry, null, 2)}
                        </pre>
                      </details>
                    ))}
                </>
              )}
            </TabsContent>
            <TabsContent value="actions" className="space-y-3 max-h-[calc(100dvh-22rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto pr-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await Promise.resolve(clearTraceEvents());
                    setTraceEvents([]);
                    toast({ title: 'Traces cleared' });
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear traces
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleExportTraces(false)}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share / Export
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleExportTraces(true)}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share Redacted
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Total action summaries: {actionSummaries.length}</p>
              {actionSummaries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No actions recorded.</p>
              ) : (
                actionSummaries
                  .slice(-100)
                  .reverse()
                  .map((summary) => {
                    const restEffects = summary.effects.filter((effect): effect is RestEffect => effect.type === 'REST');
                    const ftpEffects = summary.effects.filter((effect): effect is FtpEffect => effect.type === 'FTP');
                    const summaryTime = summary.startTimestamp ? formatLocalTime(summary.startTimestamp) : 'Unknown time';
                    return (
                      <details
                        key={summary.correlationId}
                        data-testid={`action-summary-${summary.correlationId}`}
                        className="rounded-lg border border-border p-3"
                      >
                        <summary className="cursor-pointer text-sm font-medium flex justify-between items-center gap-3 select-none">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${summary.summaryOrigin === 'HUMAN' ? 'bg-green-500' : 'bg-blue-500'}`}
                              aria-label={summary.summaryOrigin}
                            />
                            <span className="truncate">{summary.actionName}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {summary.restCount > 0 ? (
                              <span
                                data-testid={`action-rest-count-${summary.correlationId}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-purple-500 text-xs font-semibold text-white"
                                aria-label="REST effects"
                              >
                                {summary.restCount}
                              </span>
                            ) : null}
                            {summary.ftpCount > 0 ? (
                              <span
                                data-testid={`action-ftp-count-${summary.correlationId}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-700 text-xs font-semibold text-white"
                                aria-label="FTP effects"
                              >
                                {summary.ftpCount}
                              </span>
                            ) : null}
                            {summary.errorCount > 0 ? (
                              <span
                                data-testid={`action-error-count-${summary.correlationId}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-semibold text-white"
                                aria-label="Errors"
                              >
                                {summary.errorCount}
                              </span>
                            ) : null}
                            <span className="text-muted-foreground font-mono text-xs ml-2 shrink-0">
                              {summaryTime}
                            </span>
                            {summary.durationMs !== null ? (
                              <span className="text-muted-foreground text-xs">{summary.durationMs} ms</span>
                            ) : null}
                          </div>
                        </summary>
                        <div className="mt-3 space-y-3 text-xs">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <p className="text-muted-foreground">Correlation</p>
                              <p className="font-mono">{summary.correlationId}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Action</p>
                              <p>{summary.actionName}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Origin</p>
                              <p>{summary.originalOrigin ?? 'unknown'} → {summary.summaryOrigin}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Outcome</p>
                              <p>{summary.outcome}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Start</p>
                              <p>{summary.startTimestamp ? formatLocalTime(summary.startTimestamp) : 'Unknown'}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">End</p>
                              <p>{summary.endTimestamp ? formatLocalTime(summary.endTimestamp) : 'Unknown'}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Duration</p>
                              <p>{summary.durationMs !== null ? `${summary.durationMs} ms` : 'Unknown'}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Error</p>
                              <p className={summary.errorMessage ? 'text-destructive' : ''}>{summary.errorMessage ?? 'None'}</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-semibold">REST Effects</p>
                            {restEffects.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No REST effects.</p>
                            ) : (
                              restEffects.map((effect, index) => (
                                <div
                                  key={`${summary.correlationId}-rest-${index}`}
                                  data-testid={`action-rest-effect-${summary.correlationId}-${index}`}
                                  className="rounded-md border border-border/70 p-2"
                                >
                                  <p className="font-medium">{effect.method} {effect.path}</p>
                                  <p className="text-muted-foreground">
                                    target: {effect.target ?? 'unknown'} · status: {effect.status ?? 'unknown'}
                                    {effect.durationMs !== null ? ` · ${effect.durationMs} ms` : ''}
                                  </p>
                                  {effect.error ? (
                                    <p className="text-destructive">error: {effect.error}</p>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-semibold">FTP Effects</p>
                            {ftpEffects.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No FTP effects.</p>
                            ) : (
                              ftpEffects.map((effect, index) => (
                                <div
                                  key={`${summary.correlationId}-ftp-${index}`}
                                  data-testid={`action-ftp-effect-${summary.correlationId}-${index}`}
                                  className="rounded-md border border-border/70 p-2"
                                >
                                  <p className="font-medium">{effect.operation} {effect.path}</p>
                                  <p className="text-muted-foreground">
                                    target: {effect.target ?? 'unknown'} · result: {effect.result ?? 'unknown'}
                                  </p>
                                  {effect.error ? (
                                    <p className="text-destructive">error: {effect.error}</p>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </details>
                    );
                  })
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <div className="flex flex-col gap-2 w-full sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              {isLogTab ? (
                <div className="flex flex-wrap gap-2 min-w-0">
                  <Button variant="outline" onClick={() => handleShareLogs(false)}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Share {logExportLabel}
                  </Button>
                  <Button variant="outline" onClick={() => handleShareLogs(true)}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Share redacted {logExportLabel}
                  </Button>
                  <Button variant="outline" onClick={() => handleEmailLogs(false)}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Email {logExportLabel}
                  </Button>
                  <Button variant="outline" onClick={() => handleEmailLogs(true)}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Email redacted {logExportLabel}
                  </Button>
                </div>
              ) : (
                <div />
              )}
              <div className="flex flex-wrap gap-2 min-w-0">
                <Button
                  variant="destructive"
                  onClick={() => {
                    clearLogs();
                    toast({ title: 'Logs cleared' });
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear logs
                </Button>
                <Button variant="outline" onClick={() => setLogsDialogOpen(false)}>Close</Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
