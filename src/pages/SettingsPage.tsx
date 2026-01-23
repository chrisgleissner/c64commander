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
} from 'lucide-react';
import { useC64Connection } from '@/hooks/useC64Connection';
import { C64_DEFAULTS } from '@/lib/c64api';
import { useThemeContext } from '@/components/ThemeProvider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
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
import { addErrorLog, clearLogs, formatLogsForShare, getErrorLogs, getLogs } from '@/lib/logging';
import { useDeveloperMode } from '@/hooks/useDeveloperMode';
import { useMockMode } from '@/hooks/useMockMode';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { clampListPreviewLimit } from '@/lib/uiPreferences';
import {
  clampConfigWriteIntervalMs,
  loadConfigWriteIntervalMs,
  loadDebugLoggingEnabled,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
} from '@/lib/config/appSettings';

type Theme = 'light' | 'dark' | 'system';

export default function SettingsPage() {
  const { status, baseUrl, password, deviceHost, updateConfig, refetch } = useC64Connection();
  const { theme, setTheme } = useThemeContext();
  const { isDeveloperModeEnabled, enableDeveloperMode } = useDeveloperMode();
  const { value: isHvscEnabled, setValue: setHvscEnabled } = useFeatureFlag('hvsc_enabled');
  const { limit: listPreviewLimit, setLimit: setListPreviewLimit } = useListPreviewLimit();
  const {
    isMockMode,
    isMockAvailable,
    isBusy: isMockBusy,
    mockBaseUrl,
    enableMockMode,
    disableMockMode,
  } = useMockMode();
  
  const [urlInput, setUrlInput] = useState(baseUrl);
  const [passwordInput, setPasswordInput] = useState(password);
  const [isSaving, setIsSaving] = useState(false);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [diagnosticsTab, setDiagnosticsTab] = useState<'errors' | 'logs'>('errors');
  const [logs, setLogs] = useState(getLogs());
  const [errorLogs, setErrorLogs] = useState(getErrorLogs());
  const [listPreviewInput, setListPreviewInput] = useState(String(listPreviewLimit));
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(loadDebugLoggingEnabled());
  const [configWriteIntervalMs, setConfigWriteIntervalMs] = useState(loadConfigWriteIntervalMs());
  const devTapTimestamps = useRef<number[]>([]);

  useEffect(() => {
    setUrlInput(baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    setPasswordInput(password);
  }, [password]);

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
    };
    window.addEventListener('c64u-app-settings-updated', handler);
    return () => window.removeEventListener('c64u-app-settings-updated', handler);
  }, []);

  const logsPayload = useMemo(() => formatLogsForShare(logs), [logs]);
  const errorsPayload = useMemo(() => formatLogsForShare(errorLogs), [errorLogs]);
  const activePayload = diagnosticsTab === 'errors' ? errorsPayload : logsPayload;

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
      updateConfig(urlInput, passwordInput || undefined, deviceHost);
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

  const handleMockToggle = async (checked: boolean) => {
    try {
      if (checked) {
        await enableMockMode();
        toast({ title: 'Mocked C64U enabled' });
      } else {
        await disableMockMode();
        toast({ title: 'Mocked C64U disabled' });
      }
    } catch (error) {
      toast({
        title: 'Unable to update mock mode',
        description: (error as Error).message,
        variant: 'destructive',
      });
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

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <h1 className="c64-header text-xl">Settings</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Connection & appearance
          </p>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* Connection Settings */}
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
              <Label htmlFor="baseUrl" className="text-sm">Base URL</Label>
              <Input
                id="baseUrl"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={C64_DEFAULTS.DEFAULT_BASE_URL}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Default: {C64_DEFAULTS.DEFAULT_BASE_URL}
              </p>
              <p className="text-xs text-muted-foreground">
                Local proxy: {C64_DEFAULTS.DEFAULT_PROXY_URL}
              </p>
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
                Required if network password is set on firmware 3.12+
              </p>
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
              onClick={() => refetch()}
              disabled={status.isConnecting}
              aria-label="Refresh connection"
            >
              <RefreshCw className={`h-4 w-4 ${status.isConnecting ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Connection Status */}
          <div className={`p-3 rounded-lg text-sm ${
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

        {/* Logs & Diagnostics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
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

            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <Label htmlFor="debug-logging" className="font-medium">Debug REST logging</Label>
                <p className="text-xs text-muted-foreground">
                  Records every REST call with method, path, status, and latency.
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

        {/* Theme Settings */}
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

        {/* Library Settings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-medium">Library</h2>
          </div>

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
        </motion.div>

        {isDeveloperModeEnabled && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="bg-card border border-border rounded-xl p-4 space-y-4"
          >
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Cpu className="h-5 w-5 text-primary" />
              </div>
              <h2 className="font-medium">Developer</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
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
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">Enable mocked C64U (internal testing)</p>
                  <p className="text-xs text-muted-foreground">
                    Starts a local REST service and routes all requests to it.
                  </p>
                  {mockBaseUrl ? (
                    <p className="text-xs font-mono text-muted-foreground">{mockBaseUrl}</p>
                  ) : null}
                  {!isMockAvailable ? (
                    <p className="text-xs text-muted-foreground">
                      Available on Android native builds only.
                    </p>
                  ) : null}
                </div>
                <Checkbox
                  checked={isMockMode}
                  disabled={isMockBusy || !isMockAvailable}
                  onCheckedChange={(checked) => handleMockToggle(checked === true)}
                />
              </div>
              {isMockMode ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  Internal testing mode is active. No real hardware is being controlled.
                </div>
              ) : null}
            </div>
          </motion.div>
        )}

        {/* About */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
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
        <DialogContent>
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
            <TabsContent value="errors" className="space-y-2 max-h-[360px] overflow-y-auto">
              {errorLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No errors recorded.</p>
              ) : (
                errorLogs.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{entry.message}</p>
                    <p className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</p>
                    {entry.details && (
                      <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </TabsContent>
            <TabsContent value="logs" className="space-y-2 max-h-[360px] overflow-y-auto">
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
                      <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
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
