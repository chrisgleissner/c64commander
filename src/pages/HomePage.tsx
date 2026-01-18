import { motion } from 'framer-motion';
import { 
  RotateCcw, 
  Power, 
  PowerOff, 
  Pause, 
  Play, 
  Menu,
  Save,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useC64Connection, useC64MachineControl, useC64Drives } from '@/hooks/useC64Connection';
import { ConnectionBadge } from '@/components/ConnectionBadge';
import { QuickActionCard } from '@/components/QuickActionCard';
import { toast } from '@/hooks/use-toast';

export default function HomePage() {
  const { status } = useC64Connection();
  const { data: drivesData } = useC64Drives();
  const controls = useC64MachineControl();

  const appVersion = __APP_VERSION__ || '';
  const gitSha = __GIT_SHA__ || '';
  const buildTime = __BUILD_TIME__ || '';

  const handleAction = async (action: () => Promise<any>, successMsg: string) => {
    try {
      await action();
      toast({ title: successMsg });
    } catch (error) {
      toast({ 
        title: 'Error', 
        description: (error as Error).message,
        variant: 'destructive' 
      });
    }
  };

  const driveA = drivesData?.drives?.find(d => 'a' in d)?.a;
  const driveB = drivesData?.drives?.find(d => 'b' in d)?.b;

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/c64commander.png"
                alt="C64 Commander"
                className="h-9 w-9 rounded-md"
              />
              <div>
                <h1 className="c64-header text-xl text-primary">C64 Commander</h1>
                <p className="text-xs text-muted-foreground">Controller</p>
              </div>
            </div>
            <ConnectionBadge status={status} />
          </div>
        </div>
      </header>

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
              <p className="font-mono font-medium truncate">{buildTime || '—'}</p>
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

        {/* Drive Status */}
        {(driveA || driveB) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-3"
          >
            <h3 className="category-header">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Drives
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {driveA && (
                <div className="config-card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-sm">Drive A</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      driveA.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                    }`}>
                      {driveA.enabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Type: {driveA.type}</p>
                  {driveA.image_file && (
                    <p className="text-xs text-primary truncate mt-1">{driveA.image_file}</p>
                  )}
                </div>
              )}
              {driveB && (
                <div className="config-card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-sm">Drive B</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      driveB.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                    }`}>
                      {driveB.enabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Type: {driveB.type}</p>
                  {driveB.image_file && (
                    <p className="text-xs text-primary truncate mt-1">{driveB.image_file}</p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-3"
        >
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Machine Control
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

        {/* Config Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
        >
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Configuration
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
    </div>
  );
}
