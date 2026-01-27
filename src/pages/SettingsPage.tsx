import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useDeveloperMode } from '@/hooks/useDeveloperMode';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { clampListPreviewLimit } from '@/lib/uiPreferences';
import {
  clampConfigWriteIntervalMs,
  loadConfigWriteIntervalMs,
  clampBackgroundRediscoveryIntervalMs,
  clampStartupDiscoveryWindowMs,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadStartupDiscoveryWindowMs,
  loadDebugLoggingEnabled,
  loadDiskAutostartMode,
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveStartupDiscoveryWindowMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiskAutostartMode,
  type DiskAutostartMode,
} from '@/lib/config/appSettings';
import { FolderPicker, type SafPersistedUri } from '@/lib/native/folderPicker';
import { getPlatform } from '@/lib/native/platform';
import { redactTreeUri } from '@/lib/native/safUtils';
import { dismissDemoInterstitial, discoverConnection } from '@/lib/connection/connectionManager';
import { useConnectionState } from '@/hooks/useConnectionState';

type Theme = 'light' | 'dark' | 'system';

export default function SettingsPage() {
  const { status, baseUrl, runtimeBaseUrl, password, deviceHost, updateConfig, refetch } = useC64Connection();
  const connectionSnapshot = useConnectionState();
  const { theme, setTheme } = useThemeContext();
  const { isDeveloperModeEnabled, enableDeveloperMode } = useDeveloperMode();
  const { value: isHvscEnabled, setValue: setHvscEnabled } = useFeatureFlag('hvsc_enabled');
  const { limit: listPreviewLimit, setLimit: setListPreviewLimit } = useListPreviewLimit();
  
  const [passwordInput, setPasswordInput] = useState(password);
  const [deviceHostInput, setDeviceHostInput] = useState(deviceHost);
  const runtimeDeviceHost = getDeviceHostFromBaseUrl(runtimeBaseUrl);
  const isDemoActive = status.state === 'DEMO_ACTIVE';
  const lastProbeSucceededAtMs = connectionSnapshot.lastProbeSucceededAtMs;
  const lastProbeFailedAtMs = connectionSnapshot.lastProbeFailedAtMs;
  const [isSaving, setIsSaving] = useState(false);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [diagnosticsTab, setDiagnosticsTab] = useState<'errors' | 'logs'>('errors');
  const [logs, setLogs] = useState(getLogs());
  const [errorLogs, setErrorLogs] = useState(getErrorLogs());
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
  const [safUris, setSafUris] = useState<SafPersistedUri[]>([]);
  const [safEntries, setSafEntries] = useState<Array<{ name: string; path: string; type: string }>>([]);
  const [safBusy, setSafBusy] = useState(false);
  const [safError, setSafError] = useState<string | null>(null);
  const devTapTimestamps = useRef<number[]>([]);
  const isAndroid = getPlatform() === 'android';

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
      if (detail.key === 'c64u_disk_autostart_mode') {
        setDiskAutostartMode(loadDiskAutostartMode());
      }
    };
    window.addEventListener('c64u-app-settings-updated', handler);
    return () => window.removeEventListener('c64u-app-settings-updated', handler);
  }, []);

  const logsPayload = useMemo(() => formatLogsForShare(logs), [logs]);
  const errorsPayload = useMemo(() => formatLogsForShare(errorLogs), [errorLogs]);
  const activePayload = diagnosticsTab === 'errors' ? errorsPayload : logsPayload;

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
      toast({ title: 'SAF diagnostics', description: 'No persisted SAF permissions found.', variant: 'destructive' });
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

  const handleShareActive = async () => {
    const content = activePayload || 'No entries recorded.';
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'C64 Commander error report',
          text: content,
        });
        return;
      }
    } catch (error) {
      addErrorLog('Share failed', { error: (error as Error).message });
    }

    try {
      await navigator.clipboard.writeText(content);
      toast({ title: 'Copied error details to clipboard' });
    } catch (error) {
      toast({
        title: 'Unable to share',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleShareViaEmail = () => {
    const address = ['apps', 'gleissner.uk'].join('@');
    const subject = encodeURIComponent('C64 Commander diagnostics');
    const body = encodeURIComponent(activePayload || 'No entries recorded.');
    window.location.href = `mailto:${address}?subject=${subject}&body=${body}`;
  };

  const handleSaveConnection = async () => {
    setIsSaving(true);
    try {
      updateConfig(deviceHostInput || C64_DEFAULTS.DEFAULT_DEVICE_HOST, passwordInput || undefined);
      await discoverConnection('settings');
      toast({ title: 'Connection settings saved' });
    } catch (error) {
      toast({
        title: 'Error',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

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

  return (
    <div className="min-h-screen pb-24">
      <AppBar title="Settings" subtitle="Connection & appearance" />

      <main className="container py-6 space-y-6">
        {/* 1. Connection Settings */}
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

        {/* 2. Diagnostics */}
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
              Logs
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

        {/* 3. Appearance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
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
                  onClick={() => setTheme(option.value)}
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
              <div className="space-y-1 min-w-0">
                <Label htmlFor="hvsc-flag" className="font-medium">
                  Enable HVSC downloads
                </Label>
                <p className="text-xs text-muted-foreground">
                  Shows HVSC download and ingest controls on the Play page.
                </p>
              </div>
              <Checkbox
                id="hvsc-flag"
                checked={isHvscEnabled}
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  void setHvscEnabled(enabled);
                  try {
                    localStorage.setItem('c64u_feature_flag:hvsc_enabled', enabled ? '1' : '0');
                    sessionStorage.setItem('c64u_feature_flag:hvsc_enabled', enabled ? '1' : '0');
                  } catch (error) {
                    addErrorLog('Feature flag storage failed', {
                      error: (error as Error).message,
                    });
                  }
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
      </main>

      <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Diagnostics</DialogTitle>
            <DialogDescription>Review app logs and error history.</DialogDescription>
          </DialogHeader>
          <Tabs
            value={diagnosticsTab}
            onValueChange={(value) => setDiagnosticsTab(value as 'errors' | 'logs')}
            className="space-y-3"
          >
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="errors">Errors</TabsTrigger>
              <TabsTrigger value="logs">All logs</TabsTrigger>
            </TabsList>
            <TabsContent value="errors" className="space-y-2 max-h-[55vh] overflow-auto pr-2">
              {errorLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No errors recorded.</p>
              ) : (
                errorLogs.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{entry.message}</p>
                    <p className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</p>
                    {entry.details && (
                      <pre className="mt-2 text-xs whitespace-pre text-muted-foreground overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </TabsContent>
            <TabsContent value="logs" className="space-y-2 max-h-[55vh] overflow-auto pr-2">
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No logs recorded.</p>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{entry.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.level.toUpperCase()} · {new Date(entry.timestamp).toLocaleString()}
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
          </Tabs>
          <DialogFooter>
            <div className="flex flex-col gap-2 w-full sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2 min-w-0">
                <Button variant="outline" onClick={handleShareActive}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
                <Button variant="outline" onClick={handleShareViaEmail}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share via email
                </Button>
              </div>
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
