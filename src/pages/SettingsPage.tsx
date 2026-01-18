import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Wifi, 
  Moon, 
  Sun, 
  Monitor,
  Lock,
  RefreshCw,
  ExternalLink,
  Info
} from 'lucide-react';
import { useC64Connection } from '@/hooks/useC64Connection';
import { C64_DEFAULTS } from '@/lib/c64api';
import { useThemeContext } from '@/components/ThemeProvider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

type Theme = 'light' | 'dark' | 'system';

export default function SettingsPage() {
  const { status, baseUrl, password, deviceHost, updateConfig, refetch } = useC64Connection();
  const { theme, setTheme } = useThemeContext();
  
  const [urlInput, setUrlInput] = useState(baseUrl);
  const [passwordInput, setPasswordInput] = useState(password);
  const [isSaving, setIsSaving] = useState(false);
  const [deviceHostInput, setDeviceHostInput] = useState(deviceHost);

  const handleSaveConnection = async () => {
    setIsSaving(true);
    try {
      updateConfig(urlInput, passwordInput || undefined, deviceHostInput || C64_DEFAULTS.DEFAULT_DEVICE_HOST);
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

  const themeOptions: { value: Theme; icon: React.ElementType; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ];

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
              <Label htmlFor="deviceHost" className="text-sm">Device Hostname</Label>
              <Input
                id="deviceHost"
                value={deviceHostInput}
                onChange={(e) => setDeviceHostInput(e.target.value)}
                placeholder={C64_DEFAULTS.DEFAULT_DEVICE_HOST}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Used when connected via local proxy. Default: {C64_DEFAULTS.DEFAULT_DEVICE_HOST}
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
              `Connected to ${status.deviceInfo?.hostname || deviceHost || baseUrl}`
            ) : (
              status.error || 'Not connected'
            )}
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

        {/* About */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
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
    </div>
  );
}
