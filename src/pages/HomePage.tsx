import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
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
import { QuickActionCard } from '@/components/QuickActionCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { addErrorLog } from '@/lib/logging';
import { useAppConfigState } from '@/hooks/useAppConfigState';
import { buildSidEnablement } from '@/lib/config/sidVolumeControl';
import { SID_ADDRESSING_ITEMS, SID_SOCKETS_ITEMS, STREAM_ITEMS } from '@/lib/config/configItems';
import { useActionTrace } from '@/hooks/useActionTrace';
import { getBuildInfo, getBuildInfoRows } from '@/lib/buildInfo';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import { buildSidControlEntries } from '@/lib/config/sidDetails';
import { buildStreamConfigValue, buildStreamControlEntries, validateStreamHost, validateStreamPort } from '@/lib/config/homeStreams';
import { resetDiskDevices, resetPrinterDevice } from '@/lib/disks/resetDrives';
import { buildSidSilenceTargets, silenceSidTargets } from '@/lib/sid/sidSilence';
import {
  FULL_RAM_SIZE_BYTES,
  clearRamAndReboot,
  dumpFullRamImage,
  loadFullRamImage,
} from '@/lib/machine/ramOperations';
import {
  buildRamDumpFileName,
  pickRamDumpFile,
  selectRamDumpFolder,
  writeRamDumpToFolder,
} from '@/lib/machine/ramDumpStorage';
import {
  loadRamDumpFolderConfig,
  saveRamDumpFolderConfig,
  type RamDumpFolderConfig,
} from '@/lib/config/ramDumpFolderStore';
import {
  buildBusIdOptions,
  buildTypeOptions,
  normalizeDriveDevices,
  type DriveDeviceClass,
} from '@/lib/drives/driveDevices';

const DRIVE_A_HOME_ITEMS = ['Drive', 'Drive Bus ID', 'Drive Type'] as const;
const DRIVE_B_HOME_ITEMS = ['Drive', 'Drive Bus ID', 'Drive Type'] as const;
const SID_AUDIO_ITEMS = [
  'Vol Socket 1',
  'Vol Socket 2',
  'Vol UltiSid 1',
  'Vol UltiSid 2',
  'Pan Socket 1',
  'Pan Socket 2',
  'Pan UltiSID 1',
  'Pan UltiSID 2',
] as const;
const HOME_SID_ADDRESSING_ITEMS = [
  ...SID_ADDRESSING_ITEMS,
  'SID Socket 1 Address',
  'SID Socket 2 Address',
] as const;
const DISK_BUS_ID_DEFAULTS = [8, 9, 10, 11];
const PRINTER_BUS_ID_DEFAULTS = [4, 5];
const PHYSICAL_DRIVE_TYPE_DEFAULTS = ['1541', '1571', '1581'];

type DriveControlSpec = {
  class: DriveDeviceClass;
  category: string;
  enabledItem: string;
  busItem: string;
  typeItem?: string;
};

const DRIVE_CONTROL_SPECS: DriveControlSpec[] = [
  { class: 'PHYSICAL_DRIVE_A', category: 'Drive A Settings', enabledItem: 'Drive', busItem: 'Drive Bus ID', typeItem: 'Drive Type' },
  { class: 'PHYSICAL_DRIVE_B', category: 'Drive B Settings', enabledItem: 'Drive', busItem: 'Drive Bus ID', typeItem: 'Drive Type' },
  { class: 'SOFT_IEC_DRIVE', category: 'SoftIEC Drive Settings', enabledItem: 'IEC Drive', busItem: 'Soft Drive Bus ID' },
];

const PRINTER_CONTROL_SPEC: DriveControlSpec = {
  class: 'PRINTER',
  category: 'Printer Settings',
  enabledItem: 'IEC printer',
  busItem: 'Bus ID',
};

export default function HomePage() {
  const api = getC64API();
  const queryClient = useQueryClient();
  const { status } = useC64Connection();
  const { data: drivesData } = useC64Drives();
  const { data: driveASettingsCategory } = useC64ConfigItems(
    'Drive A Settings',
    [...DRIVE_A_HOME_ITEMS],
    status.isConnected || status.isConnecting,
  );
  const { data: driveBSettingsCategory } = useC64ConfigItems(
    'Drive B Settings',
    [...DRIVE_B_HOME_ITEMS],
    status.isConnected || status.isConnecting,
  );
  const { data: sidSocketsCategory } = useC64ConfigItems(
    'SID Sockets Configuration',
    SID_SOCKETS_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const { data: sidAddressingCategory } = useC64ConfigItems(
    'SID Addressing',
    [...HOME_SID_ADDRESSING_ITEMS],
    status.isConnected || status.isConnecting,
  );
  const { data: audioMixerCategory } = useC64ConfigItems(
    'Audio Mixer',
    [...SID_AUDIO_ITEMS],
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
  const [powerOffDialogOpen, setPowerOffDialogOpen] = useState(false);
  const [machineExecutionState, setMachineExecutionState] = useState<'running' | 'paused'>('running');
  const [pauseResumePending, setPauseResumePending] = useState(false);
  const [configWritePending, setConfigWritePending] = useState<Record<string, boolean>>({});
  const [configOverrides, setConfigOverrides] = useState<Record<string, string | number>>({});
  const [streamDrafts, setStreamDrafts] = useState<Record<string, { enabled: boolean; ip: string; port: string }>>({});

  const buildInfo = getBuildInfo();
  const buildInfoRows = getBuildInfoRows(buildInfo);
  const streamControlEntries = useMemo(
    () => buildStreamControlEntries(streamCategory as Record<string, unknown> | undefined),
    [streamCategory],
  );
  const sidControlEntries = useMemo(
    () => buildSidControlEntries(
      audioMixerCategory as Record<string, unknown> | undefined,
      sidAddressingCategory as Record<string, unknown> | undefined,
    ),
    [audioMixerCategory, sidAddressingCategory],
  );
  const sidSilenceTargets = useMemo(() => buildSidSilenceTargets(sidControlEntries), [sidControlEntries]);
  const machineTaskBusy = machineTaskId !== null || pauseResumePending;

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
    setStreamDrafts((previous) => {
      const next = { ...previous };
      streamControlEntries.forEach((entry) => {
        if (configWritePending[`Data Streams::${entry.itemName}`]) return;
        next[entry.key] = {
          enabled: entry.enabled,
          ip: entry.ip,
          port: entry.port,
        };
      });
      return next;
    });
  }, [configWritePending, streamControlEntries]);

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

  const refreshDrivesFromDevice = trace(async function refreshDrivesFromDevice() {
    await queryClient.fetchQuery({
      queryKey: ['c64-drives'],
      queryFn: () => api.getDrives(),
      staleTime: 0,
    });
  });

  const buildConfigKey = (category: string, itemName: string) => `${category}::${itemName}`;

  const readItemValue = (payload: unknown, categoryName: string, itemName: string) => {
    const record = payload as Record<string, unknown> | undefined;
    const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
    const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
    if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
    return normalizeConfigItem(items[itemName]).value;
  };

  const readItemOptions = (payload: unknown, categoryName: string, itemName: string) => {
    const record = payload as Record<string, unknown> | undefined;
    const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
    const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
    if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return [];
    return normalizeConfigItem(items[itemName]).options ?? [];
  };

  const resolveConfigValue = (
    payload: unknown,
    category: string,
    itemName: string,
    fallback: string | number,
  ) => {
    const override = configOverrides[buildConfigKey(category, itemName)];
    if (override !== undefined) return override;
    const value = readItemValue(payload, category, itemName);
    return value === undefined ? fallback : value;
  };

  const updateConfigValue = trace(async function updateConfigValue(
    category: string,
    itemName: string,
    value: string | number,
    operation: string,
    successTitle: string,
    options: { refreshDrives?: boolean } = {},
  ) {
    const key = buildConfigKey(category, itemName);
    const previousValue = configOverrides[key];
    setConfigOverrides((previous) => ({ ...previous, [key]: value }));
    setConfigWritePending((previous) => ({ ...previous, [key]: true }));
    try {
      await api.setConfigValue(category, itemName, value);
      toast({ title: successTitle });
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey)
          && query.queryKey[0] === 'c64-config-items'
          && query.queryKey[1] === category,
      });
      if (options.refreshDrives) {
        await queryClient.fetchQuery({
          queryKey: ['c64-drives'],
          queryFn: () => api.getDrives(),
          staleTime: 0,
        });
      }
    } catch (error) {
      setConfigOverrides((previous) => {
        const next = { ...previous };
        if (previousValue === undefined) {
          delete next[key];
        } else {
          next[key] = previousValue;
        }
        return next;
      });
      reportUserError({
        operation,
        title: 'Update failed',
        description: (error as Error).message,
        error,
        context: { category, itemName, value },
      });
    } finally {
      setConfigWritePending((previous) => ({ ...previous, [key]: false }));
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
    setMachineExecutionState('running');
  });

  const handlePauseResume = trace(async function handlePauseResume() {
    if (!status.isConnected || machineTaskId !== null || pauseResumePending) return;
    const targetState = machineExecutionState === 'running' ? 'paused' : 'running';
    setPauseResumePending(true);
    try {
      if (targetState === 'paused') {
        await controls.pause.mutateAsync();
      } else {
        await controls.resume.mutateAsync();
      }
      setMachineExecutionState(targetState);
      toast({ title: targetState === 'paused' ? 'Machine paused' : 'Machine resumed' });
    } catch (error) {
      addErrorLog('Machine pause/resume failed', {
        targetState,
        error: (error as Error).message,
      });
      reportUserError({
        operation: 'HOME_MACHINE_PAUSE_RESUME',
        title: 'Machine action failed',
        description: (error as Error).message,
        error,
        context: { targetState },
      });
    } finally {
      setPauseResumePending(false);
    }
  });

  const handleSaveRam = trace(async function handleSaveRam() {
    await runMachineTask(
      'save-ram',
      async () => {
        const folder = ramDumpFolder ?? await selectRamDumpFolder();
        if (!ramDumpFolder) {
          setRamDumpFolder(folder);
        }
        const image = await dumpFullRamImage(api);
        const fileName = buildRamDumpFileName();
        await writeRamDumpToFolder(folder, fileName, image);
      },
      'RAM dump saved',
      'Saved to selected folder.',
    );
    setMachineExecutionState('running');
  });

  const handleLoadRam = trace(async function handleLoadRam() {
    await runMachineTask(
      'load-ram',
      async () => {
        const pickedFile = await pickRamDumpFile({ preferredFolder: ramDumpFolder ?? undefined });
        if (!ramDumpFolder && pickedFile.parentFolder) {
          saveRamDumpFolderConfig(pickedFile.parentFolder);
          setRamDumpFolder(pickedFile.parentFolder);
        }
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
    setMachineExecutionState('running');
  });

  const handlePowerOff = trace(async function handlePowerOff() {
    setPowerOffDialogOpen(true);
  });

  const confirmPowerOff = trace(async function confirmPowerOff() {
    setPowerOffDialogOpen(false);
    await handleAction(() => controls.powerOff.mutateAsync(), 'Powering off...');
  });

  const handleResetDrives = trace(async function handleResetDrives() {
    await runMachineTask(
      'reset-drives',
      async () => {
        await resetDiskDevices(api, drivesData ?? null);
        await refreshDrivesFromDevice();
      },
      'Drives reset',
      'Drive A, Drive B, and Soft IEC Drive were reset.',
    );
  });

  const handleResetPrinter = trace(async function handleResetPrinter() {
    await runMachineTask(
      'reset-printer',
      async () => {
        await resetPrinterDevice(api, drivesData ?? null);
        await refreshDrivesFromDevice();
      },
      'Printer reset',
      'Printer emulation was reset.',
    );
  });

  const handleEnabledToggle = trace(async function handleEnabledToggle(
    label: string,
    spec: DriveControlSpec,
    enabled: boolean,
  ) {
    const nextValue = enabled ? 'Disabled' : 'Enabled';
    await updateConfigValue(
      spec.category,
      spec.enabledItem,
      nextValue,
      'HOME_DRIVE_ENABLED',
      `${label} ${enabled ? 'disabled' : 'enabled'}`,
      { refreshDrives: true },
    );
  });

  const handleSidReset = trace(async function handleSidReset() {
    await runMachineTask(
      'sid-reset',
      async () => {
        await silenceSidTargets(api, sidSilenceTargets);
      },
      'SID reset complete',
      'All configured SID chips were silenced.',
    );
  });

  const handleStreamToggle = trace(async function handleStreamToggle(key: 'vic' | 'audio' | 'debug') {
    const entry = streamControlEntries.find((value) => value.key === key);
    if (!entry) return;
    const current = streamDrafts[key] ?? { enabled: entry.enabled, ip: entry.ip, port: entry.port };
    const next = { ...current, enabled: !current.enabled };
    setStreamDrafts((previous) => ({ ...previous, [key]: next }));
    if (next.enabled) {
      const hostError = validateStreamHost(next.ip);
      const portError = validateStreamPort(next.port);
      if (hostError || portError) {
        reportUserError({
          operation: 'STREAM_VALIDATE',
          title: 'Invalid stream target',
          description: hostError ?? portError ?? 'Invalid stream target',
          context: { stream: key, ip: next.ip, port: next.port },
        });
        setStreamDrafts((previous) => ({ ...previous, [key]: current }));
        return;
      }
    }
    await updateConfigValue(
      'Data Streams',
      entry.itemName,
      buildStreamConfigValue(next.enabled, next.ip, next.port),
      'HOME_STREAM_TOGGLE',
      `${entry.label} stream ${next.enabled ? 'enabled' : 'disabled'}`,
    );
  });

  const handleStreamFieldChange = (key: 'vic' | 'audio' | 'debug', field: 'ip' | 'port', value: string) => {
    setStreamDrafts((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] ?? { enabled: false, ip: '', port: '' }),
        [field]: value,
      },
    }));
  };

  const handleStreamCommit = trace(async function handleStreamCommit(key: 'vic' | 'audio' | 'debug') {
    const entry = streamControlEntries.find((value) => value.key === key);
    if (!entry) return;
    const current = streamDrafts[key] ?? { enabled: entry.enabled, ip: entry.ip, port: entry.port };
    if (current.enabled) {
      const hostError = validateStreamHost(current.ip);
      if (hostError) {
        reportUserError({
          operation: 'STREAM_VALIDATE',
          title: 'Invalid stream host',
          description: hostError,
          context: { stream: key, ip: current.ip },
        });
        setStreamDrafts((previous) => ({
          ...previous,
          [key]: { enabled: entry.enabled, ip: entry.ip, port: entry.port },
        }));
        return;
      }
      const portError = validateStreamPort(current.port);
      if (portError) {
        reportUserError({
          operation: 'STREAM_VALIDATE',
          title: 'Invalid stream port',
          description: portError,
          context: { stream: key, port: current.port },
        });
        setStreamDrafts((previous) => ({
          ...previous,
          [key]: { enabled: entry.enabled, ip: entry.ip, port: entry.port },
        }));
        return;
      }
    }
    await updateConfigValue(
      'Data Streams',
      entry.itemName,
      buildStreamConfigValue(current.enabled, current.ip, current.port),
      'HOME_STREAM_UPDATE',
      `${entry.label} stream updated`,
    );
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

  const normalizedDriveModel = useMemo(
    () => normalizeDriveDevices(drivesData ?? null),
    [drivesData],
  );
  const drivesByClass = useMemo(
    () => new Map(normalizedDriveModel.devices.map((entry) => [entry.class, entry])),
    [normalizedDriveModel.devices],
  );

  const sidEnablement = useMemo(
    () => buildSidEnablement(
      sidSocketsCategory as Record<string, unknown> | undefined,
      sidAddressingCategory as Record<string, unknown> | undefined,
    ),
    [sidAddressingCategory, sidSocketsCategory],
  );
  const sidStatusMap = useMemo(() => new Map([
    ['socket1', sidEnablement.socket1],
    ['socket2', sidEnablement.socket2],
    ['ultiSid1', sidEnablement.ultiSid1],
    ['ultiSid2', sidEnablement.ultiSid2],
  ]), [sidEnablement]);

  const driveControlRows = DRIVE_CONTROL_SPECS.map((spec) => {
    const device = drivesByClass.get(spec.class) ?? null;
    const payload = spec.class === 'PHYSICAL_DRIVE_A'
      ? driveASettingsCategory
      : spec.class === 'PHYSICAL_DRIVE_B'
        ? driveBSettingsCategory
        : undefined;
    const enabledValue = String(
      resolveConfigValue(payload, spec.category, spec.enabledItem, device?.enabled ? 'Enabled' : 'Disabled'),
    );
    const enabled = enabledValue.trim().toLowerCase() === 'enabled';
    const busFallback = device?.busId ?? (spec.class === 'PHYSICAL_DRIVE_A' ? 8 : spec.class === 'PHYSICAL_DRIVE_B' ? 9 : 11);
    const busValue = Number(resolveConfigValue(payload, spec.category, spec.busItem, busFallback));
    const busOptions = buildBusIdOptions(DISK_BUS_ID_DEFAULTS, Number.isFinite(busValue) ? busValue : null);

    const typeValue = spec.typeItem
      ? String(resolveConfigValue(payload, spec.category, spec.typeItem, device?.type ?? '1541'))
      : (device?.type ?? 'DOS emulation');
    const typeOptions = spec.typeItem
      ? buildTypeOptions(
        readItemOptions(payload, spec.category, spec.typeItem).map((value) => String(value)).length
          ? readItemOptions(payload, spec.category, spec.typeItem).map((value) => String(value))
          : PHYSICAL_DRIVE_TYPE_DEFAULTS,
        typeValue,
      )
      : [typeValue];

    const statusText = spec.class === 'SOFT_IEC_DRIVE'
      ? (device?.lastError ? 'Service error reported' : 'DOS emulation ready')
      : (device?.imageFile ? `Mounted: ${device.imageFile}` : 'No disk mounted');

    return {
      spec,
      device,
      enabled,
      enabledValue,
      busValue: String(busValue),
      busOptions,
      typeValue,
      typeOptions,
      statusText,
      pendingEnabled: Boolean(configWritePending[buildConfigKey(spec.category, spec.enabledItem)]),
      pendingBus: Boolean(configWritePending[buildConfigKey(spec.category, spec.busItem)]),
      pendingType: spec.typeItem ? Boolean(configWritePending[buildConfigKey(spec.category, spec.typeItem)]) : false,
    };
  });

  const printerDevice = drivesByClass.get('PRINTER') ?? null;
  const printerEnabledValue = String(
    resolveConfigValue(
      undefined,
      PRINTER_CONTROL_SPEC.category,
      PRINTER_CONTROL_SPEC.enabledItem,
      printerDevice?.enabled ? 'Enabled' : 'Disabled',
    ),
  );
  const printerEnabled = printerEnabledValue.trim().toLowerCase() === 'enabled';
  const printerBusValue = Number(
    resolveConfigValue(
      undefined,
      PRINTER_CONTROL_SPEC.category,
      PRINTER_CONTROL_SPEC.busItem,
      printerDevice?.busId ?? 4,
    ),
  );
  const printerBusOptions = buildBusIdOptions(PRINTER_BUS_ID_DEFAULTS, Number.isFinite(printerBusValue) ? printerBusValue : null);

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
            <div className="space-y-3" data-testid="home-machine-controls">
              <div className="grid grid-cols-3 gap-2 border border-destructive/20 rounded-xl bg-destructive/[0.03] p-2">
                <QuickActionCard
                  icon={RotateCcw}
                  label="Reset"
                  compact
                  variant="danger"
                  className="border-destructive/40 bg-destructive/[0.04]"
                  onClick={() =>
                    handleAction(async () => {
                      await controls.reset.mutateAsync();
                      setMachineExecutionState('running');
                    }, 'Machine reset')}
                  disabled={!status.isConnected || machineTaskBusy}
                  loading={controls.reset.isPending}
                />
                <QuickActionCard
                  icon={Power}
                  label="Reboot"
                  compact
                  variant="danger"
                  className="border-destructive/40 bg-destructive/[0.04]"
                  onClick={() =>
                    handleAction(async () => {
                      await controls.reboot.mutateAsync();
                      setMachineExecutionState('running');
                    }, 'Machine rebooting...')}
                  disabled={!status.isConnected || machineTaskBusy}
                  loading={controls.reboot.isPending}
                />
                <QuickActionCard
                  icon={PowerOff}
                  label="Power Off"
                  compact
                  variant="danger"
                  className="border-destructive bg-destructive/15"
                  onClick={() => void handlePowerOff()}
                  disabled={!status.isConnected || machineTaskBusy}
                  loading={controls.powerOff.isPending}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5 border border-border rounded-xl p-2">
                <QuickActionCard
                  icon={Menu}
                  label="Menu"
                  compact
                  onClick={() => handleAction(() => controls.menuButton.mutateAsync(), 'Menu toggled')}
                  disabled={!status.isConnected || machineTaskBusy}
                  loading={controls.menuButton.isPending}
                />
                <QuickActionCard
                  icon={machineExecutionState === 'paused' ? Play : Pause}
                  label={machineExecutionState === 'paused' ? 'Resume' : 'Pause'}
                  compact
                  className={machineExecutionState === 'paused' ? 'border-primary/60 bg-primary/10' : undefined}
                  onClick={() => void handlePauseResume()}
                  disabled={!status.isConnected || machineTaskBusy}
                  loading={pauseResumePending}
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
              </div>
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
          <div className="bg-card border border-border rounded-xl p-4 space-y-3" data-testid="home-drives-group">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide">Drive mapping</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleResetDrives()}
                disabled={!status.isConnected || machineTaskBusy}
              >
                {machineTaskId === 'reset-drives' ? 'Resetting…' : 'Reset Drives'}
              </Button>
            </div>
            <div className="space-y-2">
              {driveControlRows.map((row) => {
                const label = row.device?.label
                  ?? (row.spec.class === 'PHYSICAL_DRIVE_A'
                    ? 'Drive A'
                    : row.spec.class === 'PHYSICAL_DRIVE_B'
                      ? 'Drive B'
                      : 'Soft IEC Drive');
                const testIdSuffix = row.spec.class === 'PHYSICAL_DRIVE_A'
                  ? 'a'
                  : row.spec.class === 'PHYSICAL_DRIVE_B'
                    ? 'b'
                    : 'soft-iec';
                return (
                  <div key={row.spec.class} className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{label}</p>
                        <p className="text-xs text-muted-foreground">{row.statusText}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleEnabledToggle(label, row.spec, row.enabled)}
                        disabled={!status.isConnected || row.pendingEnabled}
                        data-testid={`home-drive-toggle-${testIdSuffix}`}
                      >
                        {row.enabled ? 'ON' : 'OFF'}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Bus ID</span>
                        <Select
                          value={row.busValue}
                          onValueChange={(value) =>
                            void updateConfigValue(
                              row.spec.category,
                              row.spec.busItem,
                              Number(value),
                              'HOME_DRIVE_BUS',
                              `${label} bus ID updated`,
                              { refreshDrives: true },
                            )}
                          disabled={!status.isConnected || row.pendingBus}
                        >
                          <SelectTrigger data-testid={`home-drive-bus-${testIdSuffix}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {row.busOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Type</span>
                        {row.spec.typeItem ? (
                          <Select
                            value={row.typeValue}
                            onValueChange={(value) =>
                              void updateConfigValue(
                                row.spec.category,
                                row.spec.typeItem!,
                                value,
                                'HOME_DRIVE_TYPE',
                                `${label} type updated`,
                                { refreshDrives: true },
                              )}
                            disabled={!status.isConnected || row.pendingType}
                          >
                            <SelectTrigger data-testid={`home-drive-type-${testIdSuffix}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {row.typeOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="h-10 rounded-md border border-border/60 bg-background px-3 flex items-center text-sm text-muted-foreground">
                            {row.typeValue}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34 }}
          className="space-y-3"
        >
          <h3 className="category-header">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Printers
          </h3>
          <div className="bg-card border border-border rounded-xl p-4 space-y-3" data-testid="home-printer-group">
            <p className="text-xs text-muted-foreground">Serial bus device (typical bus IDs: 4 or 5)</p>
            <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Printer</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleEnabledToggle('Printer', PRINTER_CONTROL_SPEC, printerEnabled)}
                  disabled={!status.isConnected || Boolean(configWritePending[buildConfigKey(PRINTER_CONTROL_SPEC.category, PRINTER_CONTROL_SPEC.enabledItem)])}
                  data-testid="home-printer-toggle"
                >
                  {printerEnabled ? 'ON' : 'OFF'}
                </Button>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Bus ID</span>
                <Select
                  value={String(printerBusValue)}
                  onValueChange={(value) =>
                    void updateConfigValue(
                      PRINTER_CONTROL_SPEC.category,
                      PRINTER_CONTROL_SPEC.busItem,
                      Number(value),
                      'HOME_PRINTER_BUS',
                      'Printer bus ID updated',
                      { refreshDrives: true },
                    )}
                  disabled={!status.isConnected || Boolean(configWritePending[buildConfigKey(PRINTER_CONTROL_SPEC.category, PRINTER_CONTROL_SPEC.busItem)])}
                >
                  <SelectTrigger data-testid="home-printer-bus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {printerBusOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleResetPrinter()}
              disabled={!status.isConnected || machineTaskBusy}
            >
              {machineTaskId === 'reset-printer' ? 'Resetting…' : 'Reset Printer'}
            </Button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 }}
          className="space-y-2"
          data-testid="home-sid-status"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-primary" data-testid="sid-status-label">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span>SID</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSidReset()}
              disabled={!status.isConnected || machineTaskBusy}
            >
              Reset
            </Button>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="space-y-3">
              {sidControlEntries.map((entry) => {
                const volumeKey = buildConfigKey('Audio Mixer', entry.volumeItem);
                const panKey = buildConfigKey('Audio Mixer', entry.panItem);
                const addressKey = buildConfigKey('SID Addressing', entry.addressItem);
                const statusValue = sidStatusMap.get(entry.key);
                const statusLabel = statusValue === undefined ? '—' : statusValue ? 'ON' : 'OFF';
                const volumeOptions = entry.volumeOptions.length ? entry.volumeOptions : [entry.volume];
                const panOptions = entry.panOptions.length ? entry.panOptions : [entry.pan];
                const addressOptions = entry.addressOptions.length ? entry.addressOptions : [entry.address];
                const selectedVolume = volumeOptions.find((option) => option.trim() === entry.volume) ?? entry.volume;
                const selectedPan = panOptions.find((option) => option.trim() === entry.pan) ?? entry.pan;
                const selectedAddress = addressOptions.find((option) => option.trim() === entry.address) ?? entry.address;
                return (
                  <div key={entry.key} className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-2" data-testid={`home-sid-entry-${entry.key}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{entry.label}</span>
                      <span className={statusValue ? 'text-xs font-semibold text-success' : 'text-xs font-semibold text-muted-foreground'}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Volume</span>
                        <Select
                          value={selectedVolume}
                          onValueChange={(value) =>
                            void updateConfigValue(
                              'Audio Mixer',
                              entry.volumeItem,
                              value,
                              'HOME_SID_VOLUME',
                              `${entry.label} volume updated`,
                            )}
                          disabled={!status.isConnected || Boolean(configWritePending[volumeKey])}
                        >
                          <SelectTrigger data-testid={`home-sid-volume-${entry.key}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {volumeOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option.trim()}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Pan</span>
                        <Select
                          value={selectedPan}
                          onValueChange={(value) =>
                            void updateConfigValue(
                              'Audio Mixer',
                              entry.panItem,
                              value,
                              'HOME_SID_PAN',
                              `${entry.label} pan updated`,
                            )}
                          disabled={!status.isConnected || Boolean(configWritePending[panKey])}
                        >
                          <SelectTrigger data-testid={`home-sid-pan-${entry.key}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {panOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Address</span>
                        <Select
                          value={selectedAddress}
                          onValueChange={(value) =>
                            void updateConfigValue(
                              'SID Addressing',
                              entry.addressItem,
                              value,
                              'HOME_SID_ADDRESS',
                              `${entry.label} address updated`,
                            )}
                          disabled={!status.isConnected || Boolean(configWritePending[addressKey])}
                        >
                          <SelectTrigger data-testid={`home-sid-address-${entry.key}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {addressOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="space-y-2"
          data-testid="home-stream-status"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-primary" data-testid="stream-status-label">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span>Streams</span>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="space-y-2">
              {streamControlEntries.map((entry) => {
                const draft = streamDrafts[entry.key] ?? { enabled: entry.enabled, ip: entry.ip, port: entry.port };
                const pending = Boolean(configWritePending[buildConfigKey('Data Streams', entry.itemName)]);
                return (
                  <div key={entry.key} className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">{entry.label}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStreamToggle(entry.key)}
                        disabled={!status.isConnected || pending}
                        data-testid={`home-stream-toggle-${entry.key}`}
                      >
                        {draft.enabled ? 'ON' : 'OFF'}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 text-[11px]">
                      <div className="space-y-1">
                        <span className="text-muted-foreground">IP</span>
                        <Input
                          value={draft.ip}
                          onChange={(event) => handleStreamFieldChange(entry.key, 'ip', event.target.value)}
                          onBlur={() => void handleStreamCommit(entry.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              void handleStreamCommit(entry.key);
                            }
                          }}
                          disabled={!status.isConnected || pending || !draft.enabled}
                          data-testid={`home-stream-ip-${entry.key}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground">Port</span>
                        <Input
                          value={draft.port}
                          onChange={(event) => handleStreamFieldChange(entry.key, 'port', event.target.value)}
                          onBlur={() => void handleStreamCommit(entry.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              void handleStreamCommit(entry.key);
                            }
                          }}
                          disabled={!status.isConnected || pending || !draft.enabled}
                          data-testid={`home-stream-port-${entry.key}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
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

      <Dialog open={powerOffDialogOpen} onOpenChange={setPowerOffDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Power Off</DialogTitle>
            <DialogDescription>
              Once powered off, this machine cannot be powered on again via software.
              Use the physical power button on the device to power it back on.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPowerOffDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmPowerOff()}
              disabled={controls.powerOff.isPending}
            >
              {controls.powerOff.isPending ? 'Powering off…' : 'Power Off'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
