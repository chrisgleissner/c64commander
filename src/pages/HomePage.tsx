import { useEffect, useMemo, useState } from 'react';
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
  FolderOpen,
} from 'lucide-react';
import { getC64API } from '@/lib/c64api';
import { useC64ConfigItems, useC64Connection, useC64MachineControl, useC64Drives } from '@/hooks/useC64Connection';
import { AppBar } from '@/components/AppBar';
import { wrapUserEvent } from '@/lib/tracing/userTrace';
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
import { buildSidEnablement } from '@/lib/config/sidVolumeControl';
import { buildSidStatusEntries } from '@/lib/config/sidStatus';
import { SID_ADDRESSING_ITEMS, SID_SOCKETS_ITEMS, STREAM_ITEMS } from '@/lib/config/configItems';
import { useActionTrace } from '@/hooks/useActionTrace';
import { getBuildInfo, getBuildInfoRows } from '@/lib/buildInfo';
import { buildStreamStatusEntries } from '@/lib/config/streamStatus';
import {
  FULL_RAM_SIZE_BYTES,
  clearRamAndReboot,
  dumpFullRamImage,
  loadFullRamImage,
} from '@/lib/machine/ramOperations';
import {
  buildRamDumpFileName,
  ensureRamDumpFolder,
  pickRamDumpFile,
  selectRamDumpFolder,
  writeRamDumpToFolder,
} from '@/lib/machine/ramDumpStorage';
import { loadRamDumpFolderConfig, type RamDumpFolderConfig } from '@/lib/config/ramDumpFolderStore';

export default function HomePage() {
  const api = getC64API();
  const navigate = useNavigate();
  const { status } = useC64Connection();
  const { data: drivesData } = useC64Drives();
  const { data: sidSocketsCategory } = useC64ConfigItems(
    'SID Sockets Configuration',
    SID_SOCKETS_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const { data: sidAddressingCategory } = useC64ConfigItems(
    'SID Addressing',
    SID_ADDRESSING_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const { data: streamCategory } = useC64ConfigItems(
    'Data Streams',
    STREAM_ITEMS,
    status.isConnected || status.isConnecting,
  );
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
  const trace = useActionTrace('HomePage');

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [applyingConfigId, setApplyingConfigId] = useState<string | null>(null);
  const [ramDumpFolder, setRamDumpFolder] = useState<RamDumpFolderConfig | null>(() => loadRamDumpFolderConfig());
  const [machineTaskId, setMachineTaskId] = useState<string | null>(null);
  const [folderTaskPending, setFolderTaskPending] = useState(false);
  const [powerOffArmed, setPowerOffArmed] = useState(false);

  const buildInfo = getBuildInfo();
  const buildInfoRows = getBuildInfoRows(buildInfo);
  const streamStatusEntries = useMemo(
    () => buildStreamStatusEntries(streamCategory as Record<string, unknown> | undefined),
    [streamCategory],
  );
  const machineTaskBusy = machineTaskId !== null;

  const handleAction = trace(async function handleAction(action: () => Promise<unknown>, successMessage: string) {
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
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as RamDumpFolderConfig | null;
      if (!detail) {
        setRamDumpFolder(null);
        return;
      }
      setRamDumpFolder(detail);
    };
    window.addEventListener('c64u-ram-dump-folder-updated', handler as EventListener);
    return () => window.removeEventListener('c64u-ram-dump-folder-updated', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!powerOffArmed) return undefined;
    const timeout = window.setTimeout(() => {
      setPowerOffArmed(false);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [powerOffArmed]);

  const runMachineTask = trace(async function runMachineTask(
    taskId: string,
    task: () => Promise<void>,
    successTitle: string,
    successDescription?: string,
  ) {
    if (machineTaskBusy) return;
    setMachineTaskId(taskId);
    try {
      await task();
      toast({
        title: successTitle,
        description: successDescription,
      });
    } catch (error) {
      reportUserError({
        operation: 'HOME_MACHINE_TASK',
        title: 'Machine action failed',
        description: (error as Error).message,
        error,
        context: { taskId },
      });
    } finally {
      setMachineTaskId(null);
    }
  });

  const handleSelectRamDumpFolder = trace(async function handleSelectRamDumpFolder() {
    setFolderTaskPending(true);
    try {
      const folder = await selectRamDumpFolder();
      setRamDumpFolder(folder);
      toast({
        title: 'RAM dump folder set',
        description: folder.rootName ?? 'Folder access granted',
      });
    } catch (error) {
      reportUserError({
        operation: 'RAM_DUMP_FOLDER_SELECT',
        title: 'Folder selection failed',
        description: (error as Error).message,
        error,
      });
    } finally {
      setFolderTaskPending(false);
    }
  });

  const handleRebootClearMemory = trace(async function handleRebootClearMemory() {
    await runMachineTask(
      'reboot-clear-memory',
      async () => {
        await clearRamAndReboot(api);
      },
      'Machine rebooting',
      'RAM cleared (excluding I/O region).',
    );
  });

  const handleSaveRam = trace(async function handleSaveRam() {
    await runMachineTask(
      'save-ram',
      async () => {
        const image = await dumpFullRamImage(api);
        const folder = await ensureRamDumpFolder();
        const fileName = buildRamDumpFileName();
        await writeRamDumpToFolder(folder, fileName, image);
        setRamDumpFolder(folder);
      },
      'RAM dump saved',
      'Saved to selected folder.',
    );
  });

  const handleLoadRam = trace(async function handleLoadRam() {
    await runMachineTask(
      'load-ram',
      async () => {
        const pickedFile = await pickRamDumpFile();
        if (pickedFile.bytes.length !== FULL_RAM_SIZE_BYTES) {
          throw new Error(
            `Invalid RAM dump size: expected ${FULL_RAM_SIZE_BYTES} bytes, got ${pickedFile.bytes.length} bytes`,
          );
        }
        await loadFullRamImage(api, pickedFile.bytes);
      },
      'RAM loaded',
      'Memory image applied successfully.',
    );
  });

  const handlePowerOff = trace(async function handlePowerOff() {
    if (!powerOffArmed) {
      setPowerOffArmed(true);
      toast({
        title: 'Confirm Power Off',
        description: 'Tap Power Off again within 5 seconds.',
      });
      return;
    }
    setPowerOffArmed(false);
    await handleAction(() => controls.powerOff.mutateAsync(), 'Powering off...');
  });

  const handleSaveToApp = trace(async function handleSaveToApp() {
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
  });

  const handleLoadFromApp = trace(async function handleLoadFromApp(configId: string) {
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
  });

  const resolveDrive = (key: 'a' | 'b') =>
    drivesData?.drives?.find((entry) => entry[key])?.[key];

  const driveA = resolveDrive('a');
  const driveB = resolveDrive('b');
  const driveADiskLabel = driveA?.enabled && driveA?.image_file
    ? driveA.image_file
    : 'No disk';

  const sidEnablement = useMemo(
    () => buildSidEnablement(
      sidSocketsCategory as Record<string, unknown> | undefined,
      sidAddressingCategory as Record<string, unknown> | undefined,
    ),
    [sidAddressingCategory, sidSocketsCategory],
  );
  const sidStatusEntries = useMemo(() => buildSidStatusEntries(sidEnablement), [sidEnablement]);
  const sidStatusMap = useMemo(
    () => new Map(sidStatusEntries.map((entry) => [entry.key, entry])),
    [sidStatusEntries],
  );

  const renderSidStatus = (key: keyof typeof sidEnablement) => {
    const entry = sidStatusMap.get(key);
    if (!entry) return null;
    const enabled = entry.enabled;
    const statusLabel = enabled === undefined ? '—' : enabled ? 'ON' : 'OFF';
    const statusClass = enabled === true
      ? 'text-success'
      : 'text-muted-foreground';
    return (
      <div key={entry.key} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-foreground">{entry.label}</span>
        <span className={`text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
      </div>
    );
  };

  const renderStreamStatus = () => (
    <div className="space-y-2" data-testid="home-stream-status">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary" data-testid="stream-status-label">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span>Streams</span>
      </div>
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="space-y-2">
          {streamStatusEntries.map((entry) => (
            <div key={entry.key} className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{entry.label}</span>
                <span className={entry.state === 'ON' ? 'text-xs font-semibold text-success' : 'text-xs font-semibold text-muted-foreground'}>
                  {entry.state}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-muted-foreground">IP</span>
                  <p className="font-medium break-words">{entry.ip}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Port</span>
                  <p className="font-medium break-words">{entry.port}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pb-24 pt-[var(--app-bar-height)]">
      <AppBar
        title="Home"
        leading={
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/c64commander.png"
              alt="C64 Commander"
              className="h-9 w-auto rounded-md shrink-0 object-contain"
              data-testid="home-header-logo"
            />
            <div className="min-w-0">
              <h1 className="c64-header text-xl truncate" data-testid="home-header-title">Home</h1>
              <p className="text-xs text-muted-foreground mt-1 truncate" data-testid="home-header-subtitle">C64 Controller</p>
            </div>
          </div>
        }
      />

      <main className="container py-6 space-y-6">
        {/* Build Info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-2"
        >
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {buildInfoRows.map((row) => (
              <div key={row.testId} className="bg-muted/50 rounded-lg px-2 py-1.5">
                <span className="text-muted-foreground">{row.label}</span>
                <p className="font-semibold text-foreground break-words" data-testid={row.testId}>
                  {row.value}
                </p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Device Info Card */}
        {status.deviceInfo && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-3"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold text-base">64</span>
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold truncate">{status.deviceInfo.product}</h2>
                <p className="text-sm text-muted-foreground truncate">
                  {status.deviceInfo.hostname}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-muted/50 rounded-lg px-2 py-1.5">
                <span className="text-muted-foreground text-xs">Firmware</span>
                <p className="font-semibold">{status.deviceInfo.firmware_version}</p>
              </div>
              <div className="bg-muted/50 rounded-lg px-2 py-1.5">
                <span className="text-muted-foreground text-xs">FPGA</span>
                <p className="font-semibold">{status.deviceInfo.fpga_version}</p>
              </div>
              <div className="bg-muted/50 rounded-lg px-2 py-1.5">
                <span className="text-muted-foreground text-xs">Core</span>
                <p className="font-semibold">{status.deviceInfo.core_version}</p>
              </div>
              <div className="bg-muted/50 rounded-lg px-2 py-1.5">
                <span className="text-muted-foreground text-xs">ID</span>
                <p className="font-semibold break-words">{status.deviceInfo.unique_id}</p>
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
            {machineTaskBusy && (
              <span className="ml-2 text-xs text-muted-foreground">Working…</span>
            )}
          </h3>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
            <div className="grid grid-cols-4 gap-2">
              <QuickActionCard
                icon={RotateCcw}
                label="Reset"
                compact
                onClick={() => handleAction(() => controls.reset.mutateAsync(), 'Machine reset')}
                disabled={!status.isConnected || machineTaskBusy}
                loading={controls.reset.isPending}
              />
              <QuickActionCard
                icon={Power}
                label="Reboot"
                compact
                onClick={() => handleAction(() => controls.reboot.mutateAsync(), 'Machine rebooting...')}
                disabled={!status.isConnected || machineTaskBusy}
                loading={controls.reboot.isPending}
              />
              <QuickActionCard
                icon={Menu}
                label="Menu"
                compact
                onClick={() => handleAction(() => controls.menuButton.mutateAsync(), 'Menu toggled')}
                disabled={!status.isConnected || machineTaskBusy}
                loading={controls.menuButton.isPending}
              />
              <QuickActionCard
                icon={Pause}
                label="Pause"
                compact
                onClick={() => handleAction(() => controls.pause.mutateAsync(), 'Machine paused')}
                disabled={!status.isConnected || machineTaskBusy}
                loading={controls.pause.isPending}
              />
              <QuickActionCard
                icon={Play}
                label="Resume"
                compact
                onClick={() => handleAction(() => controls.resume.mutateAsync(), 'Machine resumed')}
                disabled={!status.isConnected || machineTaskBusy}
                loading={controls.resume.isPending}
              />
              <QuickActionCard
                icon={RotateCcw}
                label="Reboot (Clear RAM)"
                compact
                onClick={() => void handleRebootClearMemory()}
                disabled={!status.isConnected || machineTaskBusy}
                loading={machineTaskId === 'reboot-clear-memory'}
              />
              <QuickActionCard
                icon={Download}
                label="Save RAM"
                compact
                onClick={() => void handleSaveRam()}
                disabled={!status.isConnected || machineTaskBusy}
                loading={machineTaskId === 'save-ram'}
              />
              <QuickActionCard
                icon={Upload}
                label="Load RAM"
                compact
                onClick={() => void handleLoadRam()}
                disabled={!status.isConnected || machineTaskBusy}
                loading={machineTaskId === 'load-ram'}
              />
              <QuickActionCard
                icon={PowerOff}
                label={powerOffArmed ? 'Confirm Off' : 'Power Off'}
                compact
                variant="danger"
                className="col-start-1 row-start-3 border-destructive/50 bg-destructive/5"
                onClick={() => void handlePowerOff()}
                disabled={!status.isConnected || machineTaskBusy}
                loading={controls.powerOff.isPending}
              />
            </div>

            <div className="bg-card border border-border rounded-xl p-3 space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider">RAM Dump Folder</p>
                <p className="text-sm font-medium break-words" data-testid="ram-dump-folder-value">
                  {ramDumpFolder?.rootName ?? 'Not configured'}
                </p>
                <p className="text-[11px] text-muted-foreground break-words">
                  {ramDumpFolder?.treeUri ?? 'Select a folder before first Save RAM action.'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSelectRamDumpFolder()}
                disabled={folderTaskPending || machineTaskBusy}
              >
                {folderTaskPending ? 'Changing…' : 'Change Folder'}
              </Button>
            </div>
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              className="bg-card border border-border rounded-xl p-4 space-y-2 text-sm text-left hover:border-primary/60 transition"
              onClick={wrapUserEvent(() => navigate('/disks'), 'click', 'DriveTile', { title: 'Drive A' }, 'DriveTile')}
              aria-label="Open Disks"
            >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-medium shrink-0">Drive A:</span>
                <span className={driveA?.enabled ? 'text-success shrink-0' : 'text-muted-foreground shrink-0'}>
                  {driveA?.enabled ? 'ON' : 'OFF'}
                </span>
                <span className="font-medium break-words whitespace-normal min-w-0">
                  {driveADiskLabel}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium shrink-0">Drive B:</span>
                <span className={driveB?.enabled ? 'text-success shrink-0' : 'text-muted-foreground shrink-0'}>
                  {driveB?.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            </button>
            <div className="space-y-3">
              <div className="space-y-2" data-testid="home-sid-status">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary" data-testid="sid-status-label">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>SID</span>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-2">
                    {renderSidStatus('socket1')}
                    {renderSidStatus('socket2')}
                    {renderSidStatus('ultiSid1')}
                    {renderSidStatus('ultiSid2')}
                  </div>
                </div>
              </div>
              {renderStreamStatus()}
            </div>
          </div>
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
          <div className="grid grid-cols-4 gap-2">
            <QuickActionCard
              icon={Save}
              label="Save"
              description="To flash"
              variant="success"
              compact
              onClick={() => handleAction(() => controls.saveConfig.mutateAsync(), 'Config saved to flash')}
              disabled={!status.isConnected || machineTaskBusy}
              loading={controls.saveConfig.isPending}
            />
            <QuickActionCard
              icon={RefreshCw}
              label="Load"
              description="From flash"
              compact
              onClick={() => handleAction(() => controls.loadConfig.mutateAsync(), 'Config loaded from flash')}
              disabled={!status.isConnected || machineTaskBusy}
              loading={controls.loadConfig.isPending}
            />
            <QuickActionCard
              icon={Trash2}
              label="Reset"
              description="To default"
              variant="danger"
              compact
              onClick={() => handleAction(() => controls.resetConfig.mutateAsync(), 'Config reset to defaults')}
              disabled={!status.isConnected || machineTaskBusy}
              loading={controls.resetConfig.isPending}
            />
            <QuickActionCard
              icon={Upload}
              label="Save"
              description="To App"
              variant="success"
              compact
              onClick={() => setSaveDialogOpen(true)}
              disabled={!status.isConnected || isSaving || machineTaskBusy}
              loading={isSaving}
            />
            <QuickActionCard
              icon={Download}
              label="Load"
              description="From App"
              compact
              onClick={() => setLoadDialogOpen(true)}
              disabled={!status.isConnected || appConfigs.length === 0 || machineTaskBusy}
            />
            <QuickActionCard
              icon={RotateCcw}
              label="Revert"
              description="Changes"
              compact
              onClick={() => handleAction(() => revertToInitial(), 'Config reverted')}
              disabled={!status.isConnected || isApplying || !hasChanges || machineTaskBusy}
              loading={isApplying}
            />
            <QuickActionCard
              icon={FolderOpen}
              label="Manage"
              description="App Configs"
              compact
              onClick={() => setManageDialogOpen(true)}
              disabled={!status.isConnected || appConfigs.length === 0 || machineTaskBusy}
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
