import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { SidCard } from './home/SidCard';
import { DriveCard } from './home/DriveCard';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
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
import { resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';
import { SID_ADDRESSING_ITEMS, SID_SOCKETS_ITEMS, STREAM_ITEMS } from '@/lib/config/configItems';
import { useActionTrace } from '@/hooks/useActionTrace';
import { getBuildInfo } from '@/lib/buildInfo';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import { getLedColorRgb, rgbToCss } from '@/lib/config/ledColors';
import { buildSidControlEntries, parseSidBaseAddress } from '@/lib/config/sidDetails';
import {
  buildStreamConfigValue,
  buildStreamEndpointLabel,
  buildStreamControlEntries,
  parseStreamEndpoint,
  validateStreamHost,
  validateStreamPort,
  type StreamKey,
} from '@/lib/config/homeStreams';
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
const U64_HOME_ITEMS = ['System Mode', 'CPU Speed', 'Analog Video Mode', 'Digital Video Mode', 'HDMI Scan lines'] as const;
const LED_STRIP_HOME_ITEMS = ['LedStrip Mode', 'Fixed Color', 'Strip Intensity', 'LedStrip SID Select', 'Color tint'] as const;
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
const SID_DETECTED_ITEMS = ['SID Detected Socket 1', 'SID Detected Socket 2'] as const;
const ULTISID_PROFILE_ITEMS = ['UltiSID 1 Filter Curve', 'UltiSID 2 Filter Curve'] as const;
const SID_SOCKET_SHAPING_ITEMS = [
  'SID Socket 1 1K Ohm Resistor',
  'SID Socket 2 1K Ohm Resistor',
  'SID Socket 1 Capacitors',
  'SID Socket 2 Capacitors',
] as const;
const ULTISID_SHAPING_ITEMS = [
  'UltiSID 1 Filter Resonance',
  'UltiSID 2 Filter Resonance',
  'UltiSID 1 Combined Waveforms',
  'UltiSID 2 Combined Waveforms',
  'UltiSID 1 Digis Level',
  'UltiSID 2 Digis Level',
] as const;
const HOME_SID_SOCKET_ITEMS = [...SID_SOCKETS_ITEMS, ...SID_DETECTED_ITEMS, ...SID_SOCKET_SHAPING_ITEMS] as const;
const HOME_ULTISID_ITEMS = [...ULTISID_PROFILE_ITEMS, ...ULTISID_SHAPING_ITEMS] as const;
const HOME_SID_ADDRESSING_ITEMS = [
  ...SID_ADDRESSING_ITEMS,
  'SID Socket 1 Address',
  'SID Socket 2 Address',
] as const;
const DISK_BUS_ID_DEFAULTS = [8, 9, 10, 11];
const PRINTER_BUS_ID_DEFAULTS = [4, 5];
const PHYSICAL_DRIVE_TYPE_DEFAULTS = ['1541', '1571', '1581'];
const EMPTY_SELECT_VALUE = '__empty__';
const EMPTY_SELECT_LABEL = 'Default';
const SID_SLIDER_DETENT_RANGE = 0.2;
const SID_SLIDER_STEP = 0.01;

const normalizeSelectValue = (value: string) => (value.trim().length === 0 ? EMPTY_SELECT_VALUE : value);

const resolveSelectValue = (value: string) => (value === EMPTY_SELECT_VALUE ? '' : value);

const formatSelectOptionLabel = (value: string) => (value === EMPTY_SELECT_VALUE ? EMPTY_SELECT_LABEL : value);

const normalizeSelectOptions = (options: string[], currentValue: string) => {
  const cleaned = options
    .map((option) => String(option))
    .filter((option) => option.trim().length > 0);
  const unique = Array.from(new Set(cleaned));
  if (currentValue.trim().length > 0 && !unique.includes(currentValue)) {
    unique.push(currentValue);
  }
  const includesEmpty = options.some((option) => String(option).trim().length === 0)
    || currentValue.trim().length === 0;
  return includesEmpty ? [...unique, EMPTY_SELECT_VALUE] : unique;
};

const normalizeOptionToken = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const parseNumericOption = (value: string) => {
  const match = value.trim().match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const resolveOptionIndex = (options: string[], currentValue: string) => {
  const normalizedValue = normalizeOptionToken(currentValue);
  let index = options.findIndex((option) => normalizeOptionToken(option) === normalizedValue);
  if (index >= 0) return index;
  const numericValue = parseNumericOption(currentValue);
  if (numericValue !== null) {
    index = options.findIndex((option) => parseNumericOption(option) === numericValue);
  }
  return index >= 0 ? index : 0;
};

const resolveVolumeCenterIndex = (options: string[]) => {
  const numericIndex = options.findIndex((option) => parseNumericOption(option) === 0);
  if (numericIndex >= 0) return numericIndex;
  const normalizedIndex = options.findIndex((option) => normalizeOptionToken(option) === '0 db');
  return normalizedIndex >= 0 ? normalizedIndex : null;
};

const resolvePanCenterIndex = (options: string[]) => {
  const centerIndex = options.findIndex((option) => normalizeOptionToken(option) === 'center');
  return centerIndex >= 0 ? centerIndex : null;
};

const clampSliderValue = (value: number, max: number) => Math.min(Math.max(value, 0), max);

const applySoftDetent = (value: number, centerIndex: number | null) => {
  if (centerIndex === null) return value;
  const distance = Math.abs(value - centerIndex);
  return distance <= SID_SLIDER_DETENT_RANGE ? centerIndex : value;
};

const formatSidBaseAddress = (value: unknown) => {
  const parsed = parseSidBaseAddress(value);
  if (parsed === null) return '$----';
  return `$${parsed.toString(16).toUpperCase().padStart(4, '0')}`;
};

const resolveSidSocketToggleValue = (options: string[], enable: boolean) => {
  const enabledTokens = ['enabled', 'on', 'true'];
  const disabledTokens = ['disabled', 'off', 'false'];
  const match = options.find((option) => {
    const normalized = normalizeOptionToken(option);
    return enable ? enabledTokens.includes(normalized) : disabledTokens.includes(normalized);
  });
  if (match) return match;
  if (options.length) return enable ? options[0] : options[options.length - 1];
  return enable ? 'Enabled' : 'Disabled';
};

const resolveSidAddressEnableValue = (options: string[]) => {
  const enableOption = options.find((option) => parseSidBaseAddress(option) !== null);
  return enableOption ?? options[0] ?? 'Unmapped';
};

const resolveSidAddressDisableValue = (options: string[]) => {
  const disableOption = options.find((option) => {
    const normalized = normalizeOptionToken(option);
    return normalized === 'unmapped' || normalized === 'disabled' || normalized === 'off';
  });
  return disableOption ?? 'Unmapped';
};

const isSilentSidValue = (value: string, options: string[]) => {
  const muteValue = resolveAudioMixerMuteValue(options);
  return normalizeOptionToken(value) === normalizeOptionToken(muteValue);
};

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

import { SectionHeader } from '@/components/SectionHeader';
import { cn } from '@/lib/utils';

export default function HomePage() {
  const api = getC64API();
  const queryClient = useQueryClient();
  const { status } = useC64Connection();
  const { data: drivesData } = useC64Drives();
  const { data: u64SettingsCategory } = useC64ConfigItems(
    'U64 Specific Settings',
    [...U64_HOME_ITEMS],
    status.isConnected || status.isConnecting,
  );
  const { data: ledStripCategory } = useC64ConfigItems(
    'LED Strip Settings',
    [...LED_STRIP_HOME_ITEMS],
    status.isConnected || status.isConnecting,
  );
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
    [...HOME_SID_SOCKET_ITEMS],
    status.isConnected || status.isConnecting,
  );
  const { data: ultiSidCategory } = useC64ConfigItems(
    'UltiSID Configuration',
    [...HOME_ULTISID_ITEMS],
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
  const { data: softIecConfig } = useC64ConfigItems(
    'SoftIEC Drive Settings',
    ['IEC Drive', 'Soft Drive Bus ID', 'Default Path'],
    status.isConnected || status.isConnecting,
  );
  const { data: printerConfig } = useC64ConfigItems(
    'Printer Settings',
    ['IEC printer', 'Bus ID'],
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
  const [systemInfoExpanded, setSystemInfoExpanded] = useState(false);
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [applyingConfigId, setApplyingConfigId] = useState<string | null>(null);
  const [ramDumpFolder, setRamDumpFolder] = useState<RamDumpFolderConfig | null>(() => loadRamDumpFolderConfig());
  const [machineTaskId, setMachineTaskId] = useState<string | null>(null);
  const machineTaskInFlightRef = useRef<string | null>(null);
  const [folderTaskPending, setFolderTaskPending] = useState(false);
  const [powerOffDialogOpen, setPowerOffDialogOpen] = useState(false);
  const [machineExecutionState, setMachineExecutionState] = useState<'running' | 'paused'>('running');
  const [pauseResumePending, setPauseResumePending] = useState(false);
  const [configWritePending, setConfigWritePending] = useState<Record<string, boolean>>({});
  const [configOverrides, setConfigOverrides] = useState<Record<string, string | number>>({});
  const [streamDrafts, setStreamDrafts] = useState<Record<string, { enabled: boolean; ip: string; port: string; endpoint: string }>>({});
  const [activeStreamEditorKey, setActiveStreamEditorKey] = useState<StreamKey | null>(null);
  const [streamEditorError, setStreamEditorError] = useState<string | null>(null);
  const [activeSlider, setActiveSlider] = useState<{ id: string; value: number } | null>(null);
  const [mountTarget, setMountTarget] = useState<{
    spec: DriveControlSpec;
    currentPath?: string;
  } | null>(null);

  const sourceGroups = useMemo(() => {
    const groups: SourceGroup[] = [];
    if (status.isConnected) {
      groups.push({
        label: 'C64 Ultimate',
        sources: [createUltimateSourceLocation()],
      });
    }
    return groups;
  }, [status.isConnected]);

  const handleMountClick = (spec: DriveControlSpec, currentPath?: string) => {
    setMountTarget({ spec, currentPath });
  };

  const handleMountSelection = async (source: unknown, selections: { path: string }[]) => {
    if (!mountTarget || selections.length === 0) return false;
    const selected = selections[0];
    const { spec } = mountTarget;

    if (spec.class === 'SOFT_IEC_DRIVE') {
      await updateConfigValue(
        'SoftIEC Drive Settings',
        'Default Path',
        selected.path,
        'HOME_SOFT_IEC_PATH',
        'Soft IEC path updated'
      );
    } else if (spec.class === 'PHYSICAL_DRIVE_A' || spec.class === 'PHYSICAL_DRIVE_B') {
      const driveId = spec.class === 'PHYSICAL_DRIVE_A' ? 'a' : 'b';
      await handleAction(async () => {
        await api.mountDrive(driveId, selected.path);
        await refreshDrivesFromDevice();
      }, `Mounted to Drive ${driveId.toUpperCase()}`);
    }
    setMountTarget(null);
    return true;
  };

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

  const buildInfo = getBuildInfo();
  const streamControlEntries = useMemo(
    () => buildStreamControlEntries(streamCategory as Record<string, unknown> | undefined),
    [streamCategory],
  );
  const sidControlEntries = useMemo(() => {
    const entries = buildSidControlEntries(
      audioMixerCategory as Record<string, unknown> | undefined,
      sidAddressingCategory as Record<string, unknown> | undefined,
    );
    return entries.map((entry) => {
      const volumeOverride = configOverrides[buildConfigKey('Audio Mixer', entry.volumeItem)];
      const panOverride = configOverrides[buildConfigKey('Audio Mixer', entry.panItem)];
      const addressOverride = configOverrides[buildConfigKey('SID Addressing', entry.addressItem)];
      return {
        ...entry,
        volume: volumeOverride !== undefined ? String(volumeOverride) : entry.volume,
        pan: panOverride !== undefined ? String(panOverride) : entry.pan,
        addressRaw: addressOverride !== undefined ? String(addressOverride) : entry.addressRaw,
      };
    });
  }, [audioMixerCategory, configOverrides, sidAddressingCategory]);
  const sidSilenceTargets = useMemo(() => buildSidSilenceTargets(sidControlEntries), [sidControlEntries]);
  const machineTaskBusy = machineTaskId !== null || pauseResumePending;

  const inlineSelectTriggerClass =
    'h-auto w-auto border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden';

  const u64Category = u64SettingsCategory as Record<string, unknown> | undefined;
  const ledStripConfig = ledStripCategory as Record<string, unknown> | undefined;
  const videoModeOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'System Mode').map((value) => String(value));
  const videoModeValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'System Mode', '—'));
  const analogVideoOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'Analog Video Mode').map((value) => String(value));
  const analogVideoValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'Analog Video Mode', '—'));
  const digitalVideoOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'Digital Video Mode').map((value) => String(value));
  const digitalVideoValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'Digital Video Mode', '—'));
  const hdmiScanOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'HDMI Scan lines').map((value) => String(value));
  const hdmiScanValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'HDMI Scan lines', 'Disabled'));
  const cpuSpeedOptions = readItemOptions(u64Category, 'U64 Specific Settings', 'CPU Speed').map((value) => String(value));
  const cpuSpeedValue = String(resolveConfigValue(u64Category, 'U64 Specific Settings', 'CPU Speed', '1'));

  const ledModeOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'LedStrip Mode').map((value) => String(value));
  const ledModeValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'LedStrip Mode', 'Off'));
  const ledFixedColorOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'Fixed Color').map((value) => String(value));
  const ledFixedColorValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'Fixed Color', '—'));
  const ledIntensityOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'Strip Intensity').map((value) => String(value));
  const ledSidSelectOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'LedStrip SID Select').map((value) => String(value));
  const ledTintOptions = readItemOptions(ledStripConfig, 'LED Strip Settings', 'Color tint').map((value) => String(value));
  const ledTintValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'Color tint', 'Pure'));
  const ledSidSelectValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'LedStrip SID Select', '—'));
  const ledIntensityValue = String(resolveConfigValue(ledStripConfig, 'LED Strip Settings', 'Strip Intensity', '0'));

  const ultiSidConfig = ultiSidCategory as Record<string, unknown> | undefined;
  const ultiSid1ProfileValue = String(resolveConfigValue(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 1 Filter Curve', '—'));
  const ultiSid2ProfileValue = String(resolveConfigValue(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 2 Filter Curve', '—'));
  const ultiSid1ProfileOptions = readItemOptions(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 1 Filter Curve').map((value) => String(value));
  const ultiSid2ProfileOptions = readItemOptions(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 2 Filter Curve').map((value) => String(value));

  const sidDetectedSocket1 = String(resolveConfigValue(
    sidSocketsCategory as Record<string, unknown> | undefined,
    'SID Sockets Configuration',
    'SID Detected Socket 1',
    'None',
  ));
  const sidDetectedSocket2 = String(resolveConfigValue(
    sidSocketsCategory as Record<string, unknown> | undefined,
    'SID Sockets Configuration',
    'SID Detected Socket 2',
    'None',
  ));

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
          endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
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
    if (machineTaskInFlightRef.current !== null || machineTaskBusy) return;
    machineTaskInFlightRef.current = taskId;
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
      if (machineTaskInFlightRef.current === taskId) {
        machineTaskInFlightRef.current = null;
      }
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

  const handleSidEnableToggle = trace(async function handleSidEnableToggle(
    entry: ReturnType<typeof buildSidControlEntries>[number],
    enabled: boolean,
  ) {
    if (entry.key === 'socket1' || entry.key === 'socket2') {
      const socketIndex = entry.key === 'socket1' ? 1 : 2;
      const socketItem = `SID Socket ${socketIndex}`;
      const socketOptions = readItemOptions(
        sidSocketsCategory as Record<string, unknown> | undefined,
        'SID Sockets Configuration',
        socketItem,
      ).map((value) => String(value));
      const nextValue = resolveSidSocketToggleValue(socketOptions, !enabled);
      await updateConfigValue(
        'SID Sockets Configuration',
        socketItem,
        nextValue,
        'HOME_SID_ENABLED',
        `${entry.label} ${enabled ? 'disabled' : 'enabled'}`,
      );
      return;
    }

    const addressOptions = entry.addressOptions.length ? entry.addressOptions : [entry.address];
    const nextValue = enabled
      ? resolveSidAddressDisableValue(addressOptions)
      : resolveSidAddressEnableValue(addressOptions);
    await updateConfigValue(
      'SID Addressing',
      entry.addressItem,
      nextValue,
      'HOME_SID_ADDRESS',
      `${entry.label} ${enabled ? 'disabled' : 'enabled'}`,
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

  const handleStreamToggle = trace(async function handleStreamToggle(key: StreamKey) {
    const entry = streamControlEntries.find((value) => value.key === key);
    if (!entry) return;
    const current = streamDrafts[key] ?? {
      enabled: entry.enabled,
      ip: entry.ip,
      port: entry.port,
      endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
    };
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
        setStreamEditorError(hostError ?? portError ?? 'Invalid stream target');
        setStreamDrafts((previous) => ({ ...previous, [key]: current }));
        return;
      }
    }
    setStreamEditorError(null);
    await updateConfigValue(
      'Data Streams',
      entry.itemName,
      buildStreamConfigValue(next.enabled, next.ip, next.port),
      'HOME_STREAM_TOGGLE',
      `${entry.label} stream ${next.enabled ? 'enabled' : 'disabled'}`,
    );
  });

  const handleStreamFieldChange = (key: StreamKey, value: string) => {
    const parsed = parseStreamEndpoint(value);
    setStreamEditorError(null);
    setStreamDrafts((previous) => {
      const fallback = { enabled: false, ip: '', port: '', endpoint: '' };
      const current = previous[key] ?? fallback;
      return {
        ...previous,
        [key]: {
          ...current,
          endpoint: value,
          ip: parsed.ip,
          port: parsed.port,
        },
      };
    });
  };

  const handleStreamEditOpen = (key: StreamKey) => {
    const entry = streamControlEntries.find((value) => value.key === key);
    if (!entry) return;
    setStreamDrafts((previous) => ({
      ...previous,
      [key]: {
        enabled: entry.enabled,
        ip: entry.ip,
        port: entry.port,
        endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
      },
    }));
    setStreamEditorError(null);
    setActiveStreamEditorKey(key);
  };

  const handleStreamEditCancel = (key: StreamKey) => {
    const entry = streamControlEntries.find((value) => value.key === key);
    if (entry) {
      setStreamDrafts((previous) => ({
        ...previous,
        [key]: {
          enabled: entry.enabled,
          ip: entry.ip,
          port: entry.port,
          endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
        },
      }));
    }
    setStreamEditorError(null);
    setActiveStreamEditorKey((previous) => (previous === key ? null : previous));
  };

  const handleStreamCommit = trace(async function handleStreamCommit(key: StreamKey) {
    const entry = streamControlEntries.find((value) => value.key === key);
    if (!entry) return false;
    const current = streamDrafts[key] ?? {
      enabled: entry.enabled,
      ip: entry.ip,
      port: entry.port,
      endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
    };
    const parsed = parseStreamEndpoint(current.endpoint);
    if (parsed.error) {
      reportUserError({
        operation: 'STREAM_VALIDATE',
        title: 'Invalid stream endpoint',
        description: parsed.error,
        context: { stream: key, endpoint: current.endpoint },
      });
      setStreamEditorError(parsed.error);
      return false;
    }
    const nextIp = parsed.ip;
    const nextPort = parsed.port;
    setStreamDrafts((previous) => ({
      ...previous,
      [key]: {
        ...current,
        ip: nextIp,
        port: nextPort,
        endpoint: buildStreamEndpointLabel(nextIp, nextPort),
      },
    }));
    const hostError = validateStreamHost(nextIp);
    if (hostError) {
      reportUserError({
        operation: 'STREAM_VALIDATE',
        title: 'Invalid stream host',
        description: hostError,
        context: { stream: key, ip: nextIp },
      });
      setStreamEditorError(hostError);
      return false;
    }
    const portError = validateStreamPort(nextPort);
    if (portError) {
      reportUserError({
        operation: 'STREAM_VALIDATE',
        title: 'Invalid stream port',
        description: portError,
        context: { stream: key, port: nextPort },
      });
      setStreamEditorError(portError);
      return false;
    }
    setStreamEditorError(null);
    await updateConfigValue(
      'Data Streams',
      entry.itemName,
      buildStreamConfigValue(current.enabled, nextIp, nextPort),
      'HOME_STREAM_UPDATE',
      `${entry.label} stream updated`,
    );
    return true;
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
  const driveSummaryItems = useMemo(() => {
    const entries = [
      { key: 'a', label: 'Drive A', device: drivesByClass.get('PHYSICAL_DRIVE_A') ?? null },
      { key: 'b', label: 'Drive B', device: drivesByClass.get('PHYSICAL_DRIVE_B') ?? null },
      { key: 'softiec', label: 'Soft IEC', device: drivesByClass.get('SOFT_IEC_DRIVE') ?? null },
    ];
    return entries.map((entry) => ({
      ...entry,
      mountedLabel: entry.device?.imageFile || 'No disk mounted',
      isMounted: Boolean(entry.device?.imageFile),
    }));
  }, [drivesByClass]);

  const effectiveVideoModeOptions = videoModeOptions.length ? videoModeOptions : [videoModeValue];
  const effectiveAnalogVideoOptions = analogVideoOptions.length ? analogVideoOptions : [analogVideoValue];
  const effectiveDigitalVideoOptions = digitalVideoOptions.length ? digitalVideoOptions : [digitalVideoValue];
  const effectiveHdmiScanOptions = hdmiScanOptions.length ? hdmiScanOptions : [hdmiScanValue];
  const effectiveCpuSpeedOptions = cpuSpeedOptions.length ? cpuSpeedOptions : [cpuSpeedValue];
  const effectiveLedModeOptions = ledModeOptions.length ? ledModeOptions : [ledModeValue];
  const effectiveLedFixedColorOptions = ledFixedColorOptions.length ? ledFixedColorOptions : [ledFixedColorValue];
  const effectiveLedIntensityOptions = ledIntensityOptions.length ? ledIntensityOptions : [ledIntensityValue];
  const effectiveLedSidSelectOptions = ledSidSelectOptions.length ? ledSidSelectOptions : [ledSidSelectValue];
  const effectiveLedTintOptions = ledTintOptions.length ? ledTintOptions : [ledTintValue];
  const effectiveUltiSid1ProfileOptions = ultiSid1ProfileOptions.length ? ultiSid1ProfileOptions : [ultiSid1ProfileValue];
  const effectiveUltiSid2ProfileOptions = ultiSid2ProfileOptions.length ? ultiSid2ProfileOptions : [ultiSid2ProfileValue];

  const videoModeSelectOptions = normalizeSelectOptions(effectiveVideoModeOptions, videoModeValue);
  const analogVideoSelectOptions = normalizeSelectOptions(effectiveAnalogVideoOptions, analogVideoValue);
  const digitalVideoSelectOptions = normalizeSelectOptions(effectiveDigitalVideoOptions, digitalVideoValue);
  const hdmiScanSelectOptions = normalizeSelectOptions(effectiveHdmiScanOptions, hdmiScanValue);
  const ledModeSelectOptions = normalizeSelectOptions(effectiveLedModeOptions, ledModeValue);
  const ledFixedColorSelectOptions = normalizeSelectOptions(effectiveLedFixedColorOptions, ledFixedColorValue);
  const ledIntensitySelectOptions = normalizeSelectOptions(effectiveLedIntensityOptions, ledIntensityValue);
  const ledSidSelectSelectOptions = normalizeSelectOptions(effectiveLedSidSelectOptions, ledSidSelectValue);
  const ledTintSelectOptions = normalizeSelectOptions(effectiveLedTintOptions, ledTintValue);
  const ultiSid1ProfileSelectOptions = normalizeSelectOptions(effectiveUltiSid1ProfileOptions, ultiSid1ProfileValue);
  const ultiSid2ProfileSelectOptions = normalizeSelectOptions(effectiveUltiSid2ProfileOptions, ultiSid2ProfileValue);

  const videoModeSelectValue = normalizeSelectValue(videoModeValue);
  const analogVideoSelectValue = normalizeSelectValue(analogVideoValue);
  const digitalVideoSelectValue = normalizeSelectValue(digitalVideoValue);
  const hdmiScanSelectValue = normalizeSelectValue(hdmiScanValue);
  const ledModeSelectValue = normalizeSelectValue(ledModeValue);
  const ledFixedColorSelectValue = normalizeSelectValue(ledFixedColorValue);
  const ledIntensitySelectValue = normalizeSelectValue(ledIntensityValue);
  const ledSidSelectSelectValue = normalizeSelectValue(ledSidSelectValue);
  const ledTintSelectValue = normalizeSelectValue(ledTintValue);
  const ultiSid1ProfileSelectValue = normalizeSelectValue(ultiSid1ProfileValue);
  const ultiSid2ProfileSelectValue = normalizeSelectValue(ultiSid2ProfileValue);

  const cpuSpeedPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'CPU Speed')]);
  const videoModePending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'System Mode')]);
  const analogVideoPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'Analog Video Mode')]);
  const digitalVideoPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'Digital Video Mode')]);
  const hdmiScanPending = Boolean(configWritePending[buildConfigKey('U64 Specific Settings', 'HDMI Scan lines')]);
  const ledModePending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'LedStrip Mode')]);
  const ledFixedColorPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'Fixed Color')]);
  const ledIntensityPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'Strip Intensity')]);
  const ledSidSelectPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'LedStrip SID Select')]);
  const ledTintPending = Boolean(configWritePending[buildConfigKey('LED Strip Settings', 'Color tint')]);

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

    return {
      spec,
      device,
      enabled,
      enabledValue,
      busValue: String(busValue),
      busOptions,
      typeValue,
      typeOptions,
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
              <p className="text-xs text-muted-foreground mt-1 truncate" data-testid="home-header-subtitle">C64 Commander</p>
            </div>
          </div>
        }
      />

      <main className="container py-5 space-y-4">
        {/* System Info (collapsed by default) */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          type="button"
          onClick={() => setSystemInfoExpanded((prev) => !prev)}
          className="w-full text-left px-1 py-1"
          aria-expanded={systemInfoExpanded}
          data-testid="home-system-info"
          data-section-label="System info"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">App</span>
            <span className="font-semibold text-foreground" data-testid="home-system-version">
              {buildInfo.versionLabel || '—'}
            </span>
            <span className="text-muted-foreground">Device</span>
            <span className="font-semibold text-foreground" data-testid="home-system-device">
              {status.deviceInfo?.hostname || status.deviceInfo?.product || '—'}
            </span>
            <span className="text-muted-foreground">Firmware</span>
            <span className="font-semibold text-foreground" data-testid="home-system-firmware">
              {status.deviceInfo?.firmware_version || '—'}
            </span>
          </div>
          {systemInfoExpanded && (
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <span>Git</span>
                <span className="font-semibold text-foreground" data-testid="home-system-git">
                  {buildInfo.gitShaShort || '—'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span>Build</span>
                <span className="font-semibold text-foreground" data-testid="home-system-build-time">
                  {buildInfo.buildTimeUtc}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span>FPGA</span>
                <span className="font-semibold text-foreground" data-testid="home-system-fpga">
                  {status.deviceInfo?.fpga_version || '—'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span>Core</span>
                <span className="font-semibold text-foreground" data-testid="home-system-core">
                  {status.deviceInfo?.core_version || '—'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span>Core ID</span>
                <span className="font-semibold text-foreground" data-testid="home-system-core-id">
                  {status.deviceInfo?.unique_id || '—'}
                </span>
              </div>
            </div>
          )}
        </motion.button>

        {/* Machine */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-2"
          data-section-label="Machine"
        >
          <SectionHeader title="Machine">
            {machineTaskBusy && (
              <span className="ml-2 text-xs text-muted-foreground">Working…</span>
            )}
          </SectionHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" data-testid="home-drive-summary">
              {driveSummaryItems.map((entry) => (
                <span key={entry.key} className="flex min-w-0 items-center gap-1">
                  <span className="font-semibold text-foreground whitespace-nowrap">{entry.label}:</span>
                  <span className={entry.isMounted ? 'text-foreground truncate' : 'text-muted-foreground truncate'}>
                    {entry.mountedLabel}
                  </span>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2" data-testid="home-machine-controls">
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
                icon={machineExecutionState === 'paused' ? Play : Pause}
                label={machineExecutionState === 'paused' ? 'Resume' : 'Pause'}
                compact
                className={machineExecutionState === 'paused' ? 'border-primary/60 bg-primary/10' : undefined}
                onClick={() => void handlePauseResume()}
                disabled={!status.isConnected || machineTaskBusy}
                loading={pauseResumePending}
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
                icon={RotateCcw}
                label="Reboot (Clear RAM)"
                compact
                onClick={() => void handleRebootClearMemory()}
                disabled={!status.isConnected || machineTaskBusy}
                loading={machineTaskId === 'reboot-clear-memory'}
              />
              <QuickActionCard
                icon={PowerOff}
                label="Power Off"
                compact
                variant="danger"
                className="border-destructive/30 bg-destructive/[0.03] opacity-80"
                onClick={() => void handlePowerOff()}
                disabled={!status.isConnected || machineTaskBusy}
                loading={controls.powerOff.isPending}
              />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="space-y-2"
          data-section-label="Quick Config"
        >
          <SectionHeader title="Quick Config" />
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="bg-card border border-border rounded-xl p-3 space-y-3" data-testid="home-quick-config">
              <ConfigItemRow
                name="CPU Speed"
                category="U64 Specific Settings"
                value={cpuSpeedValue}
                options={effectiveCpuSpeedOptions}
                onValueChange={(value) =>
                  void updateConfigValue(
                    'U64 Specific Settings',
                    'CPU Speed',
                    value,
                    'HOME_CPU_SPEED',
                    'CPU speed updated',
                  )}
                isLoading={cpuSpeedPending}
                valueTestId="home-cpu-speed-value"
                sliderTestId="home-cpu-speed-slider"
                className="border-0 py-2"
              />
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Video Mode</span>
                  <Select
                    value={videoModeSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'System Mode',
                        resolveSelectValue(value),
                        'HOME_VIDEO_MODE',
                        'Video mode updated',
                      )}
                    disabled={!status.isConnected || videoModePending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-mode">
                      <SelectValue placeholder={videoModeValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {videoModeSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Analog</span>
                  <Select
                    value={analogVideoSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'Analog Video Mode',
                        resolveSelectValue(value),
                        'HOME_ANALOG_VIDEO_MODE',
                        'Analog video mode updated',
                      )}
                    disabled={!status.isConnected || analogVideoPending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-analog">
                      <SelectValue placeholder={analogVideoValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {analogVideoSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Digital</span>
                  <Select
                    value={digitalVideoSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'Digital Video Mode',
                        resolveSelectValue(value),
                        'HOME_DIGITAL_VIDEO_MODE',
                        'Digital video mode updated',
                      )}
                    disabled={!status.isConnected || digitalVideoPending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-digital">
                      <SelectValue placeholder={digitalVideoValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {digitalVideoSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">HDMI Scan Lines</span>
                  <Select
                    value={hdmiScanSelectValue}
                    onValueChange={(value) =>
                      void updateConfigValue(
                        'U64 Specific Settings',
                        'HDMI Scan lines',
                        resolveSelectValue(value),
                        'HOME_HDMI_SCAN',
                        'HDMI scan lines updated',
                      )}
                    disabled={!status.isConnected || hdmiScanPending}
                  >
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-video-scanlines">
                      <SelectValue placeholder={hdmiScanValue} />
                    </SelectTrigger>
                    <SelectContent>
                      {hdmiScanSelectOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatSelectOptionLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-card border border-border rounded-xl p-3 space-y-2" data-testid="home-led-summary">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider">LED</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Mode</span>
                    <Select
                      value={ledModeSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'LedStrip Mode',
                          resolveSelectValue(value),
                          'HOME_LED_MODE',
                          'LED mode updated',
                        )}
                      disabled={!status.isConnected || ledModePending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-mode">
                        <SelectValue placeholder={ledModeValue} />
                      </SelectTrigger>
                      <SelectContent>
                        {ledModeSelectOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatSelectOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Fixed Color</span>
                    <Select
                      value={ledFixedColorSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'Fixed Color',
                          resolveSelectValue(value),
                          'HOME_LED_COLOR',
                          'LED color updated',
                        )}
                      disabled={!status.isConnected || ledFixedColorPending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-color">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const rgb = getLedColorRgb(ledFixedColorSelectValue ?? ledFixedColorValue);
                            return rgb ? (
                              <div
                                className="w-4 h-4 rounded-sm border border-border/50 shrink-0"
                                style={{ backgroundColor: rgbToCss(rgb) }}
                                aria-hidden="true"
                              />
                            ) : null;
                          })()}
                          <span>{formatSelectOptionLabel(ledFixedColorSelectValue ?? ledFixedColorValue)}</span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {ledFixedColorSelectOptions.map((option) => {
                          const optionRgb = getLedColorRgb(option);
                          return (
                            <SelectItem key={option} value={option}>
                              <div className="flex items-center gap-2">
                                {optionRgb ? (
                                  <div
                                    className="w-4 h-4 rounded-sm border border-border/50 shrink-0"
                                    style={{ backgroundColor: rgbToCss(optionRgb) }}
                                    aria-hidden="true"
                                  />
                                ) : null}
                                <span>{formatSelectOptionLabel(option)}</span>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Intensity</span>
                    <Select
                      value={ledIntensitySelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'Strip Intensity',
                          resolveSelectValue(value),
                          'HOME_LED_INTENSITY',
                          'LED intensity updated',
                        )}
                      disabled={!status.isConnected || ledIntensityPending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-intensity">
                        <SelectValue placeholder={ledIntensityValue} />
                      </SelectTrigger>
                      <SelectContent>
                        {ledIntensitySelectOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatSelectOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">SID Select</span>
                    <Select
                      value={ledSidSelectSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'LedStrip SID Select',
                          resolveSelectValue(value),
                          'HOME_LED_SID_SELECT',
                          'LED SID select updated',
                        )}
                      disabled={!status.isConnected || ledSidSelectPending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-sid-select">
                        <SelectValue placeholder={ledSidSelectValue} />
                      </SelectTrigger>
                      <SelectContent>
                        {ledSidSelectSelectOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatSelectOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Tint</span>
                    <Select
                      value={ledTintSelectValue}
                      onValueChange={(value) =>
                        void updateConfigValue(
                          'LED Strip Settings',
                          'Color tint',
                          resolveSelectValue(value),
                          'HOME_LED_TINT',
                          'LED tint updated',
                        )}
                      disabled={!status.isConnected || ledTintPending}
                    >
                      <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-led-tint">
                        <SelectValue placeholder={ledTintValue} />
                      </SelectTrigger>
                      <SelectContent>
                        {ledTintSelectOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {formatSelectOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 space-y-2">
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
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
          data-section-label="Drives"
        >
          <SectionHeader
            title="Drives"
            resetAction={() => void handleResetDrives()}
            resetDisabled={!status.isConnected || machineTaskBusy}
            isResetting={machineTaskId === 'reset-drives'}
            resetTestId="home-drives-reset"
          />
          <div className="space-y-2" data-testid="home-drives-group">
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

              const isSoftIec = row.spec.class === 'SOFT_IEC_DRIVE';
              const mountedPath = isSoftIec
                ? String(resolveConfigValue(softIecConfig as Record<string, unknown> | undefined, 'SoftIEC Drive Settings', 'Default Path', '/USB0/'))
                : (row.device?.imageFile);
              const mountedPathLabel = isSoftIec ? 'Path' : 'Disk';
              const onMountedPathClick = () => handleMountClick(row.spec, mountedPath);

              const pathPending = isSoftIec
                ? Boolean(configWritePending[buildConfigKey('SoftIEC Drive Settings', 'Default Path')])
                : false;

              return (
                <DriveCard
                  key={row.spec.class}
                  name={label}
                  enabled={row.enabled}
                  onToggle={() => void handleEnabledToggle(label, row.spec, row.enabled)}
                  togglePending={row.pendingEnabled}
                  busIdValue={String(row.busValue)}
                  busIdOptions={row.busOptions.map(String)}
                  onBusIdChange={(value) =>
                    void updateConfigValue(
                      row.spec.category,
                      row.spec.busItem,
                      Number(value),
                      'HOME_DRIVE_BUS',
                      `${label} bus ID updated`,
                      { refreshDrives: true },
                    )}
                  busIdPending={row.pendingBus}
                  typeValue={!isSoftIec ? row.typeValue : undefined}
                  typeOptions={!isSoftIec ? row.typeOptions : undefined}
                  onTypeChange={!isSoftIec ? (value) => {
                    if (!row.spec.typeItem) return;
                    void updateConfigValue(
                      row.spec.category,
                      row.spec.typeItem,
                      value,
                      'HOME_DRIVE_TYPE',
                      `${label} type updated`,
                      { refreshDrives: true },
                    );
                  } : undefined}
                  typePending={!isSoftIec ? row.pendingType : undefined}
                  mountedPath={mountedPath}
                  mountedPathLabel={mountedPathLabel}
                  onMountedPathClick={onMountedPathClick}
                  pathPending={pathPending}
                  isConnected={status.isConnected}
                  testIdSuffix={testIdSuffix}
                />
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34 }}
          className="space-y-3"
          data-section-label="Printers"
        >
          <SectionHeader
            title="Printers"
            resetAction={() => void handleResetPrinter()}
            resetDisabled={!status.isConnected || machineTaskBusy}
            isResetting={machineTaskId === 'reset-printer'}
            resetTestId="home-printer-reset"
          />
          <div className="space-y-2" data-testid="home-printer-group">
            <div className="bg-card border border-border rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">Printer</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleEnabledToggle('Printer', PRINTER_CONTROL_SPEC, printerEnabled)}
                  disabled={!status.isConnected || Boolean(configWritePending[buildConfigKey(PRINTER_CONTROL_SPEC.category, PRINTER_CONTROL_SPEC.enabledItem)])}
                  data-testid="home-printer-toggle"
                  className={cn("h-6 px-2 text-xs", printerEnabled ? 'text-success' : undefined)}
                >
                  {printerEnabled ? 'ON' : 'OFF'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground whitespace-nowrap">Bus ID</span>
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
                    <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-printer-bus">
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
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 }}
          className="space-y-2"
          data-testid="home-sid-status"
          data-section-label="SID"
        >
          <SectionHeader
            title="SID"
            resetAction={() => void handleSidReset()}
            resetDisabled={!status.isConnected || machineTaskBusy}
            resetTestId="home-sid-reset"
          />
          <div className="space-y-3">
            {sidControlEntries.map((entry) => {
              const volumeKey = buildConfigKey('Audio Mixer', entry.volumeItem);
              const panKey = buildConfigKey('Audio Mixer', entry.panItem);
              const addressKey = buildConfigKey('SID Addressing', entry.addressItem);
              const statusValue = sidStatusMap.get(entry.key);
              const volumeOptions = entry.volumeOptions.length ? entry.volumeOptions : [entry.volume];
              const panOptions = entry.panOptions.length ? entry.panOptions : [entry.pan];
              const volumeIndex = resolveOptionIndex(volumeOptions, entry.volume);
              const panIndex = resolveOptionIndex(panOptions, entry.pan);
              const volumeCenterIndex = resolveVolumeCenterIndex(volumeOptions);
              const panCenterIndex = resolvePanCenterIndex(panOptions);
              const volumeMax = Math.max(volumeOptions.length - 1, 0);
              const panMax = Math.max(panOptions.length - 1, 0);
              const volumeSliderId = `sid-${entry.key}-volume`;
              const panSliderId = `sid-${entry.key}-pan`;
              const volumePending = Boolean(configWritePending[volumeKey]);
              const panPending = Boolean(configWritePending[panKey]);
              const isSidEnabled = statusValue !== false;
              const baseAddressLabel = formatSidBaseAddress(entry.addressRaw ?? entry.address);
              const isVolumeActive = activeSlider?.id === volumeSliderId;
              const isPanActive = activeSlider?.id === panSliderId;
              const volumeSliderValue = clampSliderValue(isVolumeActive ? activeSlider?.value ?? volumeIndex : volumeIndex, volumeMax);
              const panSliderValue = clampSliderValue(isPanActive ? activeSlider?.value ?? panIndex : panIndex, panMax);
              const isUltiSid = entry.key === 'ultiSid1' || entry.key === 'ultiSid2';

              // Identity / Filter
              const identityLabel = isUltiSid ? 'Filter' : 'SID';
              const identityValue = entry.key === 'socket1'
                ? sidDetectedSocket1
                : entry.key === 'socket2'
                  ? sidDetectedSocket2
                  : entry.key === 'ultiSid1'
                    ? ultiSid1ProfileValue
                    : ultiSid2ProfileValue;
              const identityOptions = isUltiSid
                ? (entry.key === 'ultiSid1' ? ultiSid1ProfileSelectOptions : ultiSid2ProfileSelectOptions)
                : undefined;
              const identitySelectValue = isUltiSid
                ? (entry.key === 'ultiSid1' ? ultiSid1ProfileSelectValue : ultiSid2ProfileSelectValue)
                : undefined;
              const identityPending = isUltiSid
                ? Boolean(configWritePending[buildConfigKey('UltiSID Configuration', entry.key === 'ultiSid1' ? 'UltiSID 1 Filter Curve' : 'UltiSID 2 Filter Curve')])
                : false;

              // Address
              const addressOptions = readItemOptions(sidAddressingCategory as Record<string, unknown> | undefined, 'SID Addressing', entry.addressItem).map(String);
              const addressSelectValue = resolveSelectValue(String(entry.addressRaw ?? entry.address));
              const addressPending = Boolean(configWritePending[addressKey]);

              // Shaping Controls
              const shapingControls = [];
              if (isUltiSid) {
                const ultiIndex = entry.key === 'ultiSid1' ? 1 : 2;
                const resonanceItem = `UltiSID ${ultiIndex} Filter Resonance`;
                const waveformItem = `UltiSID ${ultiIndex} Combined Waveforms`;
                const digisItem = `UltiSID ${ultiIndex} Digis Level`;

                shapingControls.push({
                  label: 'Reson',
                  value: String(resolveConfigValue(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', resonanceItem, '—')),
                  options: readItemOptions(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', resonanceItem).map(String),
                  onChange: (val: string) => void updateConfigValue('UltiSID Configuration', resonanceItem, resolveSelectValue(val), `HOME_ULTISID_RES_${ultiIndex}`, `UltiSID ${ultiIndex} resonance updated`),
                  pending: Boolean(configWritePending[buildConfigKey('UltiSID Configuration', resonanceItem)]),
                });
                shapingControls.push({
                  label: 'Wave',
                  value: String(resolveConfigValue(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', waveformItem, '—')),
                  options: readItemOptions(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', waveformItem).map(String),
                  onChange: (val: string) => void updateConfigValue('UltiSID Configuration', waveformItem, resolveSelectValue(val), `HOME_ULTISID_WAVE_${ultiIndex}`, `UltiSID ${ultiIndex} waveform updated`),
                  pending: Boolean(configWritePending[buildConfigKey('UltiSID Configuration', waveformItem)]),
                });
                shapingControls.push({
                  label: 'Digis',
                  value: String(resolveConfigValue(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', digisItem, '—')),
                  options: readItemOptions(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', digisItem).map(String),
                  onChange: (val: string) => void updateConfigValue('UltiSID Configuration', digisItem, resolveSelectValue(val), `HOME_ULTISID_DIGIS_${ultiIndex}`, `UltiSID ${ultiIndex} digis updated`),
                  pending: Boolean(configWritePending[buildConfigKey('UltiSID Configuration', digisItem)]),
                });
              } else {
                const socketIndex = entry.key === 'socket1' ? 1 : 2;
                const resistorItem = `SID Socket ${socketIndex} 1K Ohm Resistor`;
                const capacitorItem = `SID Socket ${socketIndex} Capacitors`;

                shapingControls.push({
                  label: 'Resistor',
                  value: String(resolveConfigValue(sidSocketsCategory as Record<string, unknown> | undefined, 'SID Sockets Configuration', resistorItem, '—')),
                  options: readItemOptions(sidSocketsCategory as Record<string, unknown> | undefined, 'SID Sockets Configuration', resistorItem).map(String),
                  onChange: (val: string) => void updateConfigValue('SID Sockets Configuration', resistorItem, resolveSelectValue(val), `HOME_SID_RES_${socketIndex}`, `SID Socket ${socketIndex} resistor updated`),
                  pending: Boolean(configWritePending[buildConfigKey('SID Sockets Configuration', resistorItem)]),
                });
                shapingControls.push({
                  label: 'Cap.',
                  value: String(resolveConfigValue(sidSocketsCategory as Record<string, unknown> | undefined, 'SID Sockets Configuration', capacitorItem, '—')),
                  options: readItemOptions(sidSocketsCategory as Record<string, unknown> | undefined, 'SID Sockets Configuration', capacitorItem).map(String),
                  onChange: (val: string) => void updateConfigValue('SID Sockets Configuration', capacitorItem, resolveSelectValue(val), `HOME_SID_CAP_${socketIndex}`, `SID Socket ${socketIndex} capacitor updated`),
                  pending: Boolean(configWritePending[buildConfigKey('SID Sockets Configuration', capacitorItem)]),
                });
              }

              const socketItemName = entry.key === 'socket1' ? 'SID Socket 1' : entry.key === 'socket2' ? 'SID Socket 2' : null;
              const toggleKey = socketItemName
                ? buildConfigKey('SID Sockets Configuration', socketItemName)
                : addressKey; // Fallback, though UltiSID doesn't have a toggle in config, we might need to handle it differently or disable the toggle.
              const togglePending = Boolean(configWritePending[toggleKey]);

              return (
                <SidCard
                  key={entry.key}
                  name={entry.label}
                  power={isSidEnabled}
                  onPowerToggle={!isUltiSid ? () => void handleSidEnableToggle(entry, isSidEnabled) : undefined}
                  powerPending={togglePending}
                  identityLabel={identityLabel}
                  identityValue={isUltiSid ? (identitySelectValue || identityValue) : identityValue}
                  identityOptions={identityOptions}
                  onIdentityChange={isUltiSid ? (val) => void updateConfigValue('UltiSID Configuration', entry.key === 'ultiSid1' ? 'UltiSID 1 Filter Curve' : 'UltiSID 2 Filter Curve', resolveSelectValue(val), 'HOME_ULTISID_PROFILE', `${entry.label} profile updated`) : undefined}
                  identityPending={identityPending}
                  isIdentityReadOnly={!isUltiSid}
                  addressValue={addressSelectValue || baseAddressLabel}
                  addressOptions={addressOptions}
                  onAddressChange={(val) => void updateConfigValue('SID Addressing', entry.addressItem, resolveSelectValue(val), 'HOME_SID_ADDRESS', `${entry.label} address updated`)}
                  addressPending={addressPending}
                  shapingControls={shapingControls}
                  volume={volumeSliderValue}
                  onVolumeChange={(val) => {
                    const snapped = clampSliderValue(applySoftDetent(val, volumeCenterIndex), volumeMax);
                    setActiveSlider({ id: volumeSliderId, value: snapped });
                  }}
                  volumePending={volumePending}
                  pan={panSliderValue}
                  onPanChange={(val) => {
                    const snapped = clampSliderValue(applySoftDetent(val, panCenterIndex), panMax);
                    setActiveSlider({ id: panSliderId, value: snapped });
                  }}
                  panPending={panPending}
                  isConnected={status.isConnected}
                  testIdSuffix={entry.key}
                />
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="space-y-2"
          data-testid="home-stream-status"
          data-section-label="Streams"
        >
          <SectionHeader title="Streams" />
          <div className="space-y-2">
            {streamControlEntries.map((entry) => {
              const draft = streamDrafts[entry.key] ?? {
                enabled: entry.enabled,
                ip: entry.ip,
                port: entry.port,
                endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
              };
              const pending = Boolean(configWritePending[buildConfigKey('Data Streams', entry.itemName)]);
              return (
                <div
                  key={entry.key}
                  className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
                  data-testid={`home-stream-row-${entry.key}`}
                >
                  <div
                    className="flex items-center justify-between gap-2 text-xs"
                    aria-label={`${entry.label.toUpperCase()} stream ${draft.ip}:${draft.port} ${draft.enabled ? 'ON' : 'OFF'}`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left flex items-center gap-2"
                      onClick={() => handleStreamEditOpen(entry.key)}
                      disabled={!status.isConnected || pending}
                      data-testid={`home-stream-edit-toggle-${entry.key}`}
                      aria-label={`Edit ${entry.label} stream target`}
                    >
                      <span className="font-semibold text-foreground w-12">{entry.label.toUpperCase()}</span>
                      <span className="font-semibold text-foreground truncate" data-testid={`home-stream-endpoint-display-${entry.key}`}>
                        {buildStreamEndpointLabel(draft.ip, draft.port)}
                      </span>
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleStreamToggle(entry.key)}
                      disabled={!status.isConnected || pending}
                      data-testid={`home-stream-toggle-${entry.key}`}
                      className={cn("h-6 px-2 text-xs", draft.enabled ? 'text-success' : undefined)}
                    >
                      {draft.enabled ? 'ON' : 'OFF'}
                    </Button>
                  </div>
                  {activeStreamEditorKey === entry.key && (
                    <div className="mt-2 rounded-md border border-border/60 bg-background p-2.5">
                      <div className="grid grid-cols-1 gap-2 text-[11px] md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                        <div className="space-y-1">
                          <label htmlFor={`home-stream-endpoint-${entry.key}`} className="text-muted-foreground">IP:PORT</label>
                          <Input
                            id={`home-stream-endpoint-${entry.key}`}
                            value={draft.endpoint}
                            onChange={(event) => handleStreamFieldChange(entry.key, event.target.value)}
                            disabled={!status.isConnected || pending}
                            data-testid={`home-stream-endpoint-${entry.key}`}
                            aria-label={`${entry.label} stream endpoint`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleStreamEditCancel(entry.key)}
                          disabled={!status.isConnected || pending}
                          data-testid={`home-stream-cancel-${entry.key}`}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            void (async () => {
                              const updated = await handleStreamCommit(entry.key);
                              if (updated) {
                                setActiveStreamEditorKey(null);
                              }
                            })();
                          }}
                          disabled={!status.isConnected || pending}
                          data-testid={`home-stream-confirm-${entry.key}`}
                        >
                          OK
                        </Button>
                      </div>
                      {streamEditorError && (
                        <p className="mt-2 text-[11px] text-destructive" data-testid={`home-stream-error-${entry.key}`}>
                          {streamEditorError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Config Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
          data-section-label="Config"
        >
          <SectionHeader title="Config">
            {isApplying && (
              <span className="ml-2 text-xs text-muted-foreground">Applying…</span>
            )}
          </SectionHeader>
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
              dataTestId="home-config-save-app"
              onClick={() => setSaveDialogOpen(true)}
              disabled={!status.isConnected || isSaving || machineTaskBusy}
              loading={isSaving}
            />
            <QuickActionCard
              icon={Download}
              label="Load"
              description="From App"
              compact
              dataTestId="home-config-load-app"
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
              dataTestId="home-config-manage-app"
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

      <ItemSelectionDialog
        open={mountTarget !== null}
        onOpenChange={(open) => !open && setMountTarget(null)}
        title={mountTarget?.spec.class === 'SOFT_IEC_DRIVE' ? 'Mount Path' : 'Mount Disk'}
        confirmLabel="Mount"
        sourceGroups={mountTarget?.spec.class === 'SOFT_IEC_DRIVE'
          ? sourceGroups.filter((g) => g.sources.some((s) => s.type === 'ultimate'))
          : sourceGroups}
        onConfirm={handleMountSelection}
        onAddLocalSource={async () => null}
        allowFolderSelection={mountTarget?.spec.class === 'SOFT_IEC_DRIVE'}
      />

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
    </div >
  );
}
