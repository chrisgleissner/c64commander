import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  RotateCcw,
  Power,
  PowerOff,
  Pause,
  Menu,
  Save,
  RefreshCw,
  Trash2,
  Upload,
  Play,
  Download,
  FolderOpen
} from 'lucide-react';
import { useC64Connection, useC64MachineControl, useC64Drives } from '@/hooks/useC64Connection';
import { AppBar } from '@/components/AppBar';
import { QuickActionCard } from '@/components/QuickActionCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { reportUserError } from '@/lib/uiErrors';
import { useAppConfigState } from '@/hooks/useAppConfigState';

export default function HomePage() {
  const navigate = useNavigate();
  const { status } = useC64Connection();
  const { data: drivesData } = useC64Drives();
  const controls = useC64MachineControl();
  const {
    appConfigs,
    hasChanges,
    isApplying,
    isSaving,
    revertToInitial,
    saveCurrentConfig,
    loadAppConfig,
    renameAppConfig,
    deleteAppConfig,
  } = useAppConfigState();

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [applyingConfigId, setApplyingConfigId] = useState<string | null>(null);

  const appVersion = __APP_VERSION__ || '';
  const gitSha = __GIT_SHA__ || '';
  const buildTime = __BUILD_TIME__ || '';
  
  const formatBuildTime = (isoString: string) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
      return isoString;
    }
  };

  const handleAction = async (action: () => Promise<unknown>, successMessage: string) => {
    try {
      await action();
      toast({ title: successMessage });
    } catch (error) {
      reportUserError({
        operation: 'HOME_ACTION',
        title: 'Error',
        description: (error as Error).message,
        error,
        context: { action: successMessage },
      });
    }
  };

  const handleSaveToApp = async () => {
    const trimmed = saveName.trim();
    if (!trimmed) {
      toast({ title: 'Name required', description: 'Enter a config name first.' });
      return;
    }
    if (appConfigs.some((entry) => entry.name === trimmed)) {
      toast({ title: 'Name already used', description: 'Choose a unique config name.' });
      return;
    }

    try {
      await saveCurrentConfig(trimmed);
      toast({ title: 'Saved to app', description: trimmed });
      setSaveDialogOpen(false);
      setSaveName('');
    } catch (error) {
      reportUserError({
        operation: 'APP_CONFIG_SAVE',
        title: 'Error',
        description: (error as Error).message,
        error,
        context: { name: trimmed },
      });
    }
  };

  const handleLoadFromApp = async (configId: string) => {
    const entry = appConfigs.find((config) => config.id === configId);
    if (!entry) return;
    setApplyingConfigId(configId);
    try {
      await loadAppConfig(entry);
      toast({ title: 'Config loaded', description: entry.name });
      setLoadDialogOpen(false);
    } catch (error) {
      reportUserError({
        operation: 'APP_CONFIG_LOAD',
        title: 'Error',
        description: (error as Error).message,
        error,
        context: { name: entry.name },
      });
    } finally {
      setApplyingConfigId(null);
    }
  };

  const resolveDrive = (key: 'a' | 'b') =>
    drivesData?.drives?.find((entry) => entry[key])?.[key];

  const driveA = resolveDrive('a');
  const driveB = resolveDrive('b');

  return (
    <div className="min-h-screen pb-24">
      <AppBar
        title="C64 Commander"
        leading={
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/c64commander.png"
              alt="C64 Commander"
              className="h-9 w-9 rounded-md"
            />
            <div className="min-w-0">
              <h1 className="c64-header text-xl text-primary truncate">C64 Commander</h1>
              <p className="text-xs text-muted-foreground truncate">Controller</p>
            </div>
          </div>
        }
      />

      <main className="container py-6 space-y-6">
        {/* Build Info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-3"
        >
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-muted/50 rounded-lg p-2">
              <span className="text-muted-foreground">Version</span>
              <p className="font-mono font-medium truncate">{appVersion || '—'}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <span className="text-muted-foreground">Git</span>
              <p className="font-mono font-medium truncate">
                {gitSha ? gitSha.slice(0, 8) : '—'}
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <span className="text-muted-foreground">Build</span>
              <p className="font-mono font-medium text-sm">{formatBuildTime(buildTime)}</p>
            </div>
          </div>
        </motion.div>

        {/* Device Info Card */}
        {status.deviceInfo && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-4"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="font-mono text-primary font-bold text-lg">64</span>
              </div>
              <div>
                <h2 className="font-mono font-bold">{status.deviceInfo.product}</h2>
                <p className="text-sm text-muted-foreground">
                  {status.deviceInfo.hostname}
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-muted/50 rounded-lg p-2">
                <span className="text-muted-foreground text-xs">Firmware</span>
                <p className="font-mono font-medium">{status.deviceInfo.firmware_version}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2">
                <span className="text-muted-foreground text-xs">FPGA</span>
                <p className="font-mono font-medium">{status.deviceInfo.fpga_version}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2">
                <span className="text-muted-foreground text-xs">Core</span>
                <p className="font-mono font-medium">{status.deviceInfo.core_version}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2">
                <span className="text-muted-foreground text-xs">ID</span>
                <p className="font-mono font-medium">{status.deviceInfo.unique_id}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Machine */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-3"
        >
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Machine
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <QuickActionCard
              icon={RotateCcw}
              label="Reset"
              onClick={() => handleAction(() => controls.reset.mutateAsync(), 'Machine reset')}
              disabled={!status.isConnected}
              loading={controls.reset.isPending}
            />
            <QuickActionCard
              icon={Power}
              label="Reboot"
              onClick={() => handleAction(() => controls.reboot.mutateAsync(), 'Machine rebooting...')}
              disabled={!status.isConnected}
              loading={controls.reboot.isPending}
            />
            <QuickActionCard
              icon={Menu}
              label="Menu"
              onClick={() => handleAction(() => controls.menuButton.mutateAsync(), 'Menu toggled')}
              disabled={!status.isConnected}
              loading={controls.menuButton.isPending}
            />
            <QuickActionCard
              icon={Pause}
              label="Pause"
              onClick={() => handleAction(() => controls.pause.mutateAsync(), 'Machine paused')}
              disabled={!status.isConnected}
              loading={controls.pause.isPending}
            />
            <QuickActionCard
              icon={Play}
              label="Resume"
              onClick={() => handleAction(() => controls.resume.mutateAsync(), 'Machine resumed')}
              disabled={!status.isConnected}
              loading={controls.resume.isPending}
            />
            <QuickActionCard
              icon={PowerOff}
              label="Power Off"
              variant="danger"
              onClick={() => handleAction(() => controls.powerOff.mutateAsync(), 'Powering off...')}
              disabled={!status.isConnected}
              loading={controls.powerOff.isPending}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
        >
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Drives
          </h3>
          <button
            type="button"
            className="bg-card border border-border rounded-xl p-4 space-y-2 text-sm text-left hover:border-primary/60 transition"
            onClick={() => navigate('/disks')}
            aria-label="Open Disks"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium shrink-0">Drive A:</span>
              <span className={driveA?.enabled ? 'text-success shrink-0' : 'text-muted-foreground shrink-0'}>
                {driveA?.enabled ? 'ON' : 'OFF'}
              </span>
              <span className="shrink-0">–</span>
              <span className="font-medium truncate min-w-0">
                {driveA?.enabled ? driveA?.image_file || '—' : '—'}
              </span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium shrink-0">Drive B:</span>
              <span className={driveB?.enabled ? 'text-success shrink-0' : 'text-muted-foreground shrink-0'}>
                {driveB?.enabled ? 'ON' : 'OFF'}
              </span>
            </div>
          </button>
        </motion.div>

        {/* Config Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
        >
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Config
            {isApplying && (
              <span className="ml-2 text-xs text-muted-foreground">Applying…</span>
            )}
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <QuickActionCard
              icon={Save}
              label="Save"
              description="To flash"
              variant="success"
              onClick={() => handleAction(() => controls.saveConfig.mutateAsync(), 'Config saved to flash')}
              disabled={!status.isConnected}
              loading={controls.saveConfig.isPending}
            />
            <QuickActionCard
              icon={RefreshCw}
              label="Load"
              description="From flash"
              onClick={() => handleAction(() => controls.loadConfig.mutateAsync(), 'Config loaded from flash')}
              disabled={!status.isConnected}
              loading={controls.loadConfig.isPending}
            />
            <QuickActionCard
              icon={Trash2}
              label="Reset"
              description="To default"
              variant="danger"
              onClick={() => handleAction(() => controls.resetConfig.mutateAsync(), 'Config reset to defaults')}
              disabled={!status.isConnected}
              loading={controls.resetConfig.isPending}
            />
            <QuickActionCard
              icon={Upload}
              label="Save"
              description="To App"
              variant="success"
              onClick={() => setSaveDialogOpen(true)}
              disabled={!status.isConnected || isSaving}
              loading={isSaving}
            />
            <QuickActionCard
              icon={Download}
              label="Load"
              description="From App"
              onClick={() => setLoadDialogOpen(true)}
              disabled={!status.isConnected || appConfigs.length === 0}
            />
            <QuickActionCard
              icon={RotateCcw}
              label="Revert"
              description="Changes"
              onClick={() => handleAction(() => revertToInitial(), 'Config reverted')}
              disabled={!status.isConnected || isApplying || !hasChanges}
              loading={isApplying}
            />
            <QuickActionCard
              icon={FolderOpen}
              label="Manage"
              description="App Configs"
              onClick={() => setManageDialogOpen(true)}
              disabled={!status.isConnected || appConfigs.length === 0}
            />
          </div>
        </motion.div>

        {/* Offline Message */}
        {!status.isConnected && !status.isConnecting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center"
          >
            <p className="text-sm text-destructive font-medium">Unable to connect to C64 Ultimate</p>
            <p className="text-xs text-muted-foreground mt-1">
              Check your connection settings
            </p>
          </motion.div>
        )}
      </main>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to App</DialogTitle>
            <DialogDescription>Store the current C64U configuration in this app.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Config name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveToApp} disabled={isSaving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load from App</DialogTitle>
            <DialogDescription>Select a saved configuration to apply to the C64U.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {appConfigs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved configurations yet.</p>
            ) : (
              appConfigs.map((config) => (
                <Button
                  key={config.id}
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => handleLoadFromApp(config.id)}
                  disabled={isApplying || applyingConfigId !== null}
                >
                  <span className="text-left">
                    <span className="block font-medium">{config.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(config.savedAt).toLocaleString()}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {applyingConfigId === config.id ? 'Applying…' : 'Load'}
                  </span>
                </Button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manageDialogOpen} onOpenChange={setManageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage App Configs</DialogTitle>
            <DialogDescription>Rename or delete saved configurations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {appConfigs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved configurations yet.</p>
            ) : (
              appConfigs.map((config) => (
                <div key={config.id} className="flex flex-col gap-2 border border-border rounded-lg p-3">
                  <Input
                    value={renameValues[config.id] ?? config.name}
                    onChange={(e) =>
                      setRenameValues((prev) => ({ ...prev, [config.id]: e.target.value }))
                    }
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(config.savedAt).toLocaleString()}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => renameAppConfig(config.id, renameValues[config.id]?.trim() || config.name)}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteAppConfig(config.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
