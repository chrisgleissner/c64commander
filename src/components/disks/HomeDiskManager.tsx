import { wrapUserEvent } from '@/lib/tracing/userTrace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Disc, ArrowLeftRight, ArrowRightLeft, HardDrive, X, Folder, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableActionList, type ActionListItem, type ActionListMenuItem } from '@/components/lists/SelectableActionList';
import { AddItemsProgressOverlay, type AddItemsProgressState } from '@/components/itemSelection/AddItemsProgressOverlay';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { FileOriginIcon } from '@/components/FileOriginIcon';
import { toast } from '@/hooks/use-toast';
import { useC64ConfigItems, useC64Connection, useC64Drives } from '@/hooks/useC64Connection';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { useLocalSources } from '@/hooks/useLocalSources';
import { useActionTrace } from '@/hooks/useActionTrace';
import { getC64API } from '@/lib/c64api';
import { addErrorLog, addLog } from '@/lib/logging';
import { reportUserError } from '@/lib/uiErrors';
import { cn } from '@/lib/utils';
import { QuickActionCard } from '@/components/QuickActionCard';
import { mountDiskToDrive } from '@/lib/disks/diskMount';
import { resetDiskDevices } from '@/lib/disks/resetDrives';
import { createDiskEntry, getDiskFolderPath, getLeafFolderName, isDiskImagePath, normalizeDiskPath, type DiskEntry } from '@/lib/disks/diskTypes';
import { assignDiskGroupsByPrefix } from '@/lib/disks/diskGrouping';
import { pickDiskGroupColor } from '@/lib/disks/diskGroupColors';
import { useDiskLibrary } from '@/hooks/useDiskLibrary';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { createLocalSourceLocation, resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { getLocalSourceListingMode, requireLocalSourceEntries } from '@/lib/sourceNavigation/localSourcesStore';
import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';
import { prepareDirectoryInput } from '@/lib/sourceNavigation/localSourcesStore';
import type { SelectedItem, SourceEntry, SourceLocation } from '@/lib/sourceNavigation/types';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { redactTreeUri } from '@/lib/native/safUtils';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import {
  buildBusIdOptions,
  buildTypeOptions,
  normalizeDriveDevices,
  type DriveDeviceClass,
} from '@/lib/drives/driveDevices';

const DRIVE_KEYS = ['a', 'b'] as const;

type DriveKey = (typeof DRIVE_KEYS)[number];

const buildDriveLabel = (key: DriveKey) => `Drive ${key.toUpperCase()}`;
const DRIVE_CONFIG_CATEGORY: Record<DriveKey, string> = {
  a: 'Drive A Settings',
  b: 'Drive B Settings',
};
const DRIVE_BUS_ID_ITEM = 'Drive Bus ID';
const DRIVE_TYPE_ITEM = 'Drive Type';
const DRIVE_BUS_ID_DEFAULTS = [8, 9, 10, 11] as const;
const DRIVE_TYPE_DEFAULTS = ['1541', '1571', '1581'] as const;
const DRIVE_DEFAULT_BUS_ID: Record<DriveKey, number> = { a: 8, b: 9 };
const DRIVE_DEFAULT_TYPE = '1541';
const SOFT_IEC_CONTROL = {
  class: 'SOFT_IEC_DRIVE' as DriveDeviceClass,
  category: 'SoftIEC Drive Settings',
  enabledItem: 'IEC Drive',
  busItem: 'Soft Drive Bus ID',
};

const buildDrivePath = (path?: string | null, file?: string | null) => {
  if (!file) return null;
  const base = normalizeDiskPath(path || '/');
  return base.endsWith('/') ? `${base}${file}` : `${base}/${file}`;
};

const DiskIndicator = ({ mounted }: { mounted: boolean }) => (
  <Disc className={`h-4 w-4 ${mounted ? 'text-success' : 'text-muted-foreground'}`} />
);

const LocationIcon = ({ location }: { location: DiskEntry['location'] }) => (
  <FileOriginIcon
    origin={location === 'local' ? 'local' : 'ultimate'}
    className="h-4 w-4 shrink-0 opacity-60"
    label={location === 'local' ? 'Local disk' : 'C64U disk'}
  />
);

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
};

export const HomeDiskManager = () => {
  const { status } = useC64Connection();
  const { data: drivesData } = useC64Drives();
  const uniqueId = status.deviceInfo?.unique_id || null;
  const trace = useActionTrace('HomeDiskManager');

  const diskLibrary = useDiskLibrary(uniqueId);
  const disksById = useMemo(
    () => Object.fromEntries(diskLibrary.disks.map((disk) => [disk.id, disk])),
    [diskLibrary.disks],
  );

  const [activeDrive, setActiveDrive] = useState<DriveKey | null>(null);
  const [activeDisk, setActiveDisk] = useState<DiskEntry | null>(null);
  const [driveErrors, setDriveErrors] = useState<Record<string, string>>({});
  const [mountedByDrive, setMountedByDrive] = useState<Record<string, string>>({});
  const [drivePowerOverride, setDrivePowerOverride] = useState<Record<string, boolean>>({});
  const [drivePowerPending, setDrivePowerPending] = useState<Record<string, boolean>>({});
  const [resetDrivesPending, setResetDrivesPending] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [addItemsProgress, setAddItemsProgress] = useState<AddItemsProgressState>({
    status: 'idle',
    count: 0,
    elapsedMs: 0,
    total: null,
    message: null,
  });
  const addItemsAbortRef = useRef<AbortController | null>(null);
  const cancelAddItemsScan = useCallback(() => {
    const controller = addItemsAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
  }, []);
  const [showAddItemsOverlay, setShowAddItemsOverlay] = useState(false);
  const [addItemsSurface, setAddItemsSurface] = useState<'dialog' | 'page'>('dialog');
  const [isAddingItems, setIsAddingItems] = useState(false);
  const addItemsStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayActiveRef = useRef(false);
  const [groupDialogDisk, setGroupDialogDisk] = useState<DiskEntry | null>(null);
  const [groupName, setGroupName] = useState('');
  const [renameDialogDisk, setRenameDialogDisk] = useState<DiskEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteDialogDisk, setDeleteDialogDisk] = useState<DiskEntry | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectedDiskIds, setSelectedDiskIds] = useState<Set<string>>(new Set());
  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const { sources: localSources, addSourceFromPicker, addSourceFromFiles } = useLocalSources();
  const { limit: listPreviewLimit } = useListPreviewLimit();
  const isAndroid = getPlatform() === 'android' && isNativePlatform();

  const api = getC64API();
  const queryClient = useQueryClient();
  const [driveConfigPending, setDriveConfigPending] = useState<Record<DriveKey, boolean>>({ a: false, b: false });
  const [softIecConfigPending, setSoftIecConfigPending] = useState(false);
  const refreshDrivesFromDevice = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: ['c64-drives'],
      queryFn: () => api.getDrives(),
      staleTime: 0,
    });
  }, [api, queryClient]);
  const { data: driveAConfig } = useC64ConfigItems(
    DRIVE_CONFIG_CATEGORY.a,
    [DRIVE_BUS_ID_ITEM, DRIVE_TYPE_ITEM],
    status.isConnected || status.isConnecting,
  );
  const { data: driveBConfig } = useC64ConfigItems(
    DRIVE_CONFIG_CATEGORY.b,
    [DRIVE_BUS_ID_ITEM, DRIVE_TYPE_ITEM],
    status.isConnected || status.isConnecting,
  );

  const localSourcesById = useMemo(
    () => new Map(localSources.map((source) => [source.id, source])),
    [localSources],
  );

  const sourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    const localGroupSources = localSources.map((source) => createLocalSourceLocation(source));
    return [
      { label: 'C64 Ultimate', sources: [ultimateSource] },
      { label: 'This device', sources: localGroupSources },
    ];
  }, [localSources]);

  useEffect(() => {
    setSelectedDiskIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set(Array.from(prev).filter((id) => Boolean(disksById[id])));
      return next.size === prev.size ? prev : next;
    });
  }, [disksById]);

  useEffect(() => {
    if (!drivesData?.drives?.length) return;
    setDrivePowerOverride((prev) => {
      let changed = false;
      const next = { ...prev };
      DRIVE_KEYS.forEach((drive) => {
        const info = drivesData.drives.find((entry) => entry[drive])?.[drive];
        if (info?.enabled === undefined) return;
        const override = next[drive];
        if (override !== undefined && override === info.enabled) {
          delete next[drive];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [drivesData?.drives]);

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, [toast]);

  useEffect(() => {
    if (addItemsProgress.status !== 'scanning') return undefined;
    const interval = window.setInterval(() => {
      const startedAt = addItemsStartedAtRef.current ?? Date.now();
      setAddItemsProgress((prev) => ({
        ...prev,
        elapsedMs: Date.now() - startedAt,
      }));
    }, 500);
    return () => window.clearInterval(interval);
  }, [addItemsProgress.status]);

  useEffect(() => {
    if (browserOpen) {
      setAddItemsSurface('dialog');
    }
  }, [browserOpen]);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status === 'scanning') return;
    setAddItemsProgress({ status: 'idle', count: 0, elapsedMs: 0, total: null, message: null });
  }, [addItemsProgress.status, browserOpen]);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status !== 'scanning') return;
    if (addItemsSurface !== 'page') {
      setAddItemsSurface('page');
    }
  }, [addItemsProgress.status, addItemsSurface, browserOpen]);

  useEffect(() => {
    if (addItemsProgress.status === 'scanning') return;
    if (addItemsSurface === 'page' && isAddingItems) return;
    if (addItemsSurface !== 'dialog') {
      setAddItemsSurface('dialog');
    }
  }, [addItemsProgress.status, addItemsSurface, isAddingItems]);

  const handleAutoConfirmStart = useCallback(() => {
    setAddItemsSurface('page');
    setIsAddingItems(true);
    setShowAddItemsOverlay(true);
    addItemsOverlayStartedAtRef.current = Date.now();
    addItemsOverlayActiveRef.current = true;
  }, []);

  const showNoDiskWarning = useCallback(() => {
    reportUserError({
      operation: 'DISK_IMPORT',
      title: 'No disks found',
      description: 'Found no disk file.',
    });
  }, [reportUserError]);

  const toggleSelectAll = () => {
    setSelectedDiskIds(allSelected ? new Set() : new Set(allDiskIds));
  };

  const handleDiskSelect = (disk: DiskEntry, selected: boolean) => {
    setSelectedDiskIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(disk.id);
      } else {
        next.delete(disk.id);
      }
      return next;
    });
  };

  const allDiskIds = useMemo(() => diskLibrary.disks.map((disk) => disk.id), [diskLibrary.disks]);
  const selectedCount = selectedDiskIds.size;
  const allSelected = selectedCount > 0 && selectedCount === allDiskIds.length;

  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    diskLibrary.disks.forEach((disk) => {
      if (!disk.group) return;
      counts.set(disk.group, (counts.get(disk.group) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count, color: pickDiskGroupColor(name) }));
  }, [diskLibrary.disks]);
  const sortedDisks = useMemo(
    () => diskLibrary.disks.slice().sort((a, b) => a.path.localeCompare(b.path)),
    [diskLibrary.disks],
  );

  const handleMountDisk = trace(async (drive: DriveKey, disk: DiskEntry) => {
    try {
      const runtimeFile = diskLibrary.runtimeFiles[disk.id];
      await mountDiskToDrive(api, drive, disk, runtimeFile);
      setMountedByDrive((prev) => ({ ...prev, [drive]: disk.id }));
      setDriveErrors((prev) => ({ ...prev, [drive]: '' }));
      toast({
        title: 'Disk mounted',
        description: `${disk.name} mounted in ${buildDriveLabel(drive)}`,
      });
    } catch (error) {
      setDriveErrors((prev) => ({ ...prev, [drive]: (error as Error).message }));
      addErrorLog('Disk mount failed (UI)', {
        drive,
        path: disk.path,
        location: disk.location,
        endpoint: `/v1/drives/${drive}:mount`,
        baseUrl: api.getBaseUrl(),
        deviceHost: api.getDeviceHost(),
        demoMode: status.state === 'DEMO_ACTIVE',
        error: (error as Error).message,
      });
      reportUserError({
        operation: 'DISK_MOUNT',
        title: 'Mount failed',
        description: (error as Error).message,
        error,
        context: {
          drive,
          path: disk.path,
          location: disk.location,
          endpoint: `/v1/drives/${drive}:mount`,
          baseUrl: api.getBaseUrl(),
          deviceHost: api.getDeviceHost(),
          demoMode: status.state === 'DEMO_ACTIVE',
        },
      });
    }
  });

  const handleEject = trace(async (drive: DriveKey) => {
    try {
      await api.unmountDrive(drive);
      setMountedByDrive((prev) => ({ ...prev, [drive]: '' }));
      setDriveErrors((prev) => ({ ...prev, [drive]: '' }));
      toast({ title: 'Disk ejected', description: `${buildDriveLabel(drive)} cleared` });
    } catch (error) {
      setDriveErrors((prev) => ({ ...prev, [drive]: (error as Error).message }));
      reportUserError({
        operation: 'DISK_EJECT',
        title: 'Eject failed',
        description: (error as Error).message,
        error,
        context: { drive },
      });
    }
  });

  const handleToggleDrivePower = trace(async (drive: DriveKey, targetEnabled: boolean) => {
    if (!status.isConnected) return;
    setDrivePowerPending((prev) => ({ ...prev, [drive]: true }));
    setDrivePowerOverride((prev) => ({ ...prev, [drive]: targetEnabled }));
    try {
      if (targetEnabled) {
        await api.driveOn(drive);
      } else {
        await api.driveOff(drive);
      }
      setDriveErrors((prev) => ({ ...prev, [drive]: '' }));
      toast({
        title: targetEnabled ? 'Drive powered on' : 'Drive powered off',
        description: `${buildDriveLabel(drive)} ${targetEnabled ? 'enabled' : 'disabled'}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['c64-drives'] });
    } catch (error) {
      setDrivePowerOverride((prev) => {
        const next = { ...prev };
        delete next[drive];
        return next;
      });
      setDriveErrors((prev) => ({ ...prev, [drive]: (error as Error).message }));
      reportUserError({
        operation: 'DRIVE_POWER',
        title: 'Drive power toggle failed',
        description: (error as Error).message,
        error,
        context: { drive, targetEnabled },
      });
    } finally {
      setDrivePowerPending((prev) => ({ ...prev, [drive]: false }));
    }
  });

  const handleResetDrives = trace(async () => {
    if (!status.isConnected || resetDrivesPending) return;
    setResetDrivesPending(true);
    try {
      await resetDiskDevices(api, drivesData ?? null);
      await refreshDrivesFromDevice();
      setDriveErrors((prev) => ({ ...prev, a: '', b: '' }));
      toast({
        title: 'Drives reset',
        description: 'Drive A, Drive B, and Soft IEC Drive were reset.',
      });
    } catch (error) {
      reportUserError({
        operation: 'RESET_DRIVES',
        title: 'Drive reset failed',
        description: (error as Error).message,
        error,
      });
    } finally {
      setResetDrivesPending(false);
    }
  });

  const resolveMountedDiskId = (drive: DriveKey) => {
    const driveInfo = drivesData?.drives?.find((entry) => entry[drive])?.[drive];
    const mountedOverride = mountedByDrive[drive];
    if (mountedOverride === '') return null;
    if (mountedOverride) return mountedOverride;
    if (!driveInfo?.image_file) return null;
    const fullPath = buildDrivePath(driveInfo.image_path, driveInfo.image_file);
    if (!fullPath) return null;
    const disk = diskLibrary.disks.find((entry) => entry.location === 'ultimate' && entry.path === fullPath);
    return disk?.id ?? null;
  };

  const withRetry = async <T,>(operation: string, run: () => Promise<T>, attempts = 2) => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error as Error;
        if (attempt >= attempts) break;
        addErrorLog('Drive config update retry', {
          operation,
          attempt,
          attempts,
          error: lastError.message,
        });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 120);
        });
      }
    }
    throw new Error(`${operation} failed: ${lastError?.message ?? 'unknown error'}`);
  };

  const getDriveConfigValue = (payload: unknown, drive: DriveKey, itemName: string) => {
    const categoryName = DRIVE_CONFIG_CATEGORY[drive];
    const record = payload as Record<string, unknown> | undefined;
    const categoryBlock = record?.[categoryName] as Record<string, unknown> | undefined;
    const itemsBlock = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
    if (!itemsBlock || !Object.prototype.hasOwnProperty.call(itemsBlock, itemName)) return undefined;
    return normalizeConfigItem(itemsBlock[itemName]).value;
  };

  const parseBusId = (value: unknown) => {
    const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isInteger(numeric)) return null;
    return numeric;
  };

  const parseDriveType = (value: unknown) => {
    const normalized = String(value ?? '').trim();
    return normalized.length ? normalized : null;
  };

  const resolveDriveBusId = (drive: DriveKey, payload: unknown, fallbackInfo?: { bus_id?: number }) => {
    const fromConfig = parseBusId(getDriveConfigValue(payload, drive, DRIVE_BUS_ID_ITEM));
    if (fromConfig !== null) return fromConfig;
    const fromDriveInfo = parseBusId(fallbackInfo?.bus_id);
    if (fromDriveInfo !== null) return fromDriveInfo;
    return DRIVE_DEFAULT_BUS_ID[drive];
  };

  const resolveDriveType = (drive: DriveKey, payload: unknown, fallbackInfo?: { type?: string }) => {
    const fromConfig = parseDriveType(getDriveConfigValue(payload, drive, DRIVE_TYPE_ITEM));
    if (fromConfig) return fromConfig;
    const fromDriveInfo = parseDriveType(fallbackInfo?.type);
    if (fromDriveInfo) return fromDriveInfo;
    return DRIVE_DEFAULT_TYPE;
  };

  const handleDriveConfigUpdate = trace(async (
    drive: DriveKey,
    itemName: string,
    value: string | number,
    successTitle: string,
    successDescription: string,
  ) => {
    if (!status.isConnected) return;
    setDriveConfigPending((prev) => ({ ...prev, [drive]: true }));
    try {
      const category = DRIVE_CONFIG_CATEGORY[drive];
      await withRetry(
        `${buildDriveLabel(drive)} ${itemName} update`,
        () => api.setConfigValue(category, itemName, value),
      );
      setDriveErrors((prev) => ({ ...prev, [drive]: '' }));
      toast({ title: successTitle, description: successDescription });
      await Promise.all([
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey)
            && query.queryKey[0] === 'c64-config-items'
            && query.queryKey[1] === category,
        }),
        queryClient.invalidateQueries({ queryKey: ['c64-drives'] }),
      ]);
    } catch (error) {
      setDriveErrors((prev) => ({ ...prev, [drive]: (error as Error).message }));
      reportUserError({
        operation: 'DRIVE_CONFIG_UPDATE',
        title: 'Drive setting update failed',
        description: (error as Error).message,
        error,
        context: { drive, itemName, value },
      });
    } finally {
      setDriveConfigPending((prev) => ({ ...prev, [drive]: false }));
    }
  });

  const handleSoftIecConfigUpdate = trace(async (
    itemName: 'IEC Drive' | 'Soft Drive Bus ID',
    value: string | number,
    successTitle: string,
    successDescription: string,
  ) => {
    if (!status.isConnected) return;
    setSoftIecConfigPending(true);
    try {
      await withRetry(
        `Soft IEC ${itemName} update`,
        () => api.setConfigValue(SOFT_IEC_CONTROL.category, itemName, value),
      );
      toast({ title: successTitle, description: successDescription });
      await refreshDrivesFromDevice();
    } catch (error) {
      reportUserError({
        operation: 'SOFT_IEC_CONFIG_UPDATE',
        title: 'Soft IEC setting update failed',
        description: (error as Error).message,
        error,
        context: { itemName, value },
      });
    } finally {
      setSoftIecConfigPending(false);
    }
  });

  const handleRotate = trace(async (drive: DriveKey, direction: 1 | -1) => {
    const currentId = resolveMountedDiskId(drive);
    if (!currentId) return;
    const current = disksById[currentId];
    if (!current?.group) return;

    const groupDisks = diskLibrary.disks
      .filter((disk) => disk.group === current.group)
      .slice()
      .sort((a, b) => {
        const orderA = a.importOrder ?? null;
        const orderB = b.importOrder ?? null;
        if (orderA !== null && orderB !== null) {
          return orderA - orderB;
        }
        return a.name.localeCompare(b.name);
      });

    if (groupDisks.length < 2) return;
    const index = groupDisks.findIndex((disk) => disk.id === current.id);
    const nextIndex = (index + direction + groupDisks.length) % groupDisks.length;
    const nextDisk = groupDisks[nextIndex];
    if (!nextDisk) return;
    await handleMountDisk(drive, nextDisk);
  });

  const handleDeleteDisk = trace(async (disk: DiskEntry, options: { suppressToast?: boolean } = {}) => {
    const mountedDrives = DRIVE_KEYS.filter((drive) => resolveMountedDiskId(drive) === disk.id);
    if (mountedDrives.length > 0) {
      try {
        await Promise.all(mountedDrives.map((drive) => api.unmountDrive(drive)));
        setMountedByDrive((prev) => {
          const next = { ...prev };
          mountedDrives.forEach((drive) => {
            delete next[drive];
          });
          return next;
        });
        if (!options.suppressToast) {
          toast({
            title: 'Disk removed',
            description: 'Disk ejected from mounted drives.',
          });
        }
      } catch (error) {
        addErrorLog('Disk eject failed', { error: (error as Error).message });
      }
    }
    diskLibrary.removeDisk(disk.id);
  });

  const handleBulkDelete = async () => {
    const disksToRemove = diskLibrary.disks.filter((disk) => selectedDiskIds.has(disk.id));
    if (!disksToRemove.length) {
      setBulkDeleteOpen(false);
      return;
    }
    await Promise.all(disksToRemove.map((disk) => handleDeleteDisk(disk, { suppressToast: true })));
    setSelectedDiskIds(new Set());
    setBulkDeleteOpen(false);
    toast({
      title: 'Disks removed',
      description: `${disksToRemove.length} disk(s) removed from the library.`,
    });
  };

  const handleAddDiskSelections = useCallback(trace(async (source: SourceLocation, selections: SelectedItem[]) => {
    if (isAddingItems) return false;
    try {
      const startedAt = Date.now();
      addItemsStartedAtRef.current = startedAt;
      const localTreeUri = source.type === 'local' ? localSourcesById.get(source.id)?.android?.treeUri ?? null : null;
      if (localTreeUri) {
        addLog('debug', 'SAF disk scan started', {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          rootPath: source.rootPath,
        });
      }
      if (!browserOpen) {
        setAddItemsSurface('page');
        if (!addItemsOverlayActiveRef.current) {
          setShowAddItemsOverlay(true);
          addItemsOverlayStartedAtRef.current = Date.now();
          addItemsOverlayActiveRef.current = true;
        }
      }
      setIsAddingItems(true);
      setAddItemsProgress({ status: 'scanning', count: 0, elapsedMs: 0, total: null, message: 'Scanning…' });
      const abortController = new AbortController();
      addItemsAbortRef.current = abortController;
      const abortSignal = abortController.signal;
      await new Promise((resolve) => setTimeout(resolve, 0));
      let processed = 0;
      let lastUpdate = 0;

      const updateProgress = (delta: number) => {
        processed += delta;
        const now = Date.now();
        if (now - lastUpdate < 120) return;
        lastUpdate = now;
        setAddItemsProgress((prev) => ({
          ...prev,
          count: processed,
          elapsedMs: now - startedAt,
        }));
      };

      let files: Array<{ path: string; name: string; sizeBytes?: number | null; modifiedAt?: string | null; sourceId?: string | null }> = [];
      const listingCache = new Map<string, SourceEntry[]>();
      const resolveSelectionEntry = async (filePath: string) => {
        const normalizedPath = normalizeSourcePath(filePath);
        const parent = normalizedPath.slice(0, normalizedPath.lastIndexOf('/') + 1) || '/';
        if (!listingCache.has(parent)) {
          try {
            listingCache.set(parent, await source.listEntries(parent));
          } catch {
            listingCache.set(parent, []);
          }
        }
        const entries = listingCache.get(parent) ?? [];
        return entries.find(
          (entry) => entry.type === 'file' && normalizeSourcePath(entry.path) === normalizedPath,
        ) ?? null;
      };
      for (const selection of selections) {
        if (abortSignal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (selection.type === 'dir') {
          const nested = await source.listFilesRecursive(selection.path, { signal: abortSignal });
          updateProgress(nested.length);
          nested.forEach((entry) => {
            if (entry.type !== 'file') return;
            files.push({ path: entry.path, name: entry.name, sizeBytes: entry.sizeBytes, modifiedAt: entry.modifiedAt, sourceId: source.id });
          });
        } else {
          const entryPath = normalizeSourcePath(selection.path);
          const meta = await resolveSelectionEntry(entryPath);
          files.push({
            path: entryPath,
            name: meta?.name ?? selection.name,
            sizeBytes: meta?.sizeBytes ?? null,
            modifiedAt: meta?.modifiedAt ?? null,
            sourceId: source.id,
          });
          updateProgress(1);
        }
      }

      let diskCandidates = files.filter((entry) => isDiskImagePath(entry.path));
      if (!diskCandidates.length && source.type === 'local' && selections.length === 1 && selections[0]?.type === 'dir') {
        const selectionPath = normalizeSourcePath(selections[0].path);
        const rootPath = normalizeSourcePath(source.rootPath);
        if (selectionPath === rootPath) {
          const localSource = localSourcesById.get(source.id);
          if (localSource && getLocalSourceListingMode(localSource) === 'entries') {
            try {
              const entries = requireLocalSourceEntries(localSource, 'HomeDiskManager.localFallback');
              files = entries.map((entry) => ({
                path: normalizeSourcePath(entry.relativePath),
                name: entry.name,
                sizeBytes: entry.sizeBytes ?? null,
                modifiedAt: entry.modifiedAt ?? null,
                sourceId: source.id,
              }));
              diskCandidates = files.filter((entry) => isDiskImagePath(entry.path));
            } catch (error) {
              addErrorLog('Local source fallback failed', {
                sourceId: localSource.id,
                error: {
                  name: (error as Error).name,
                  message: (error as Error).message,
                  stack: (error as Error).stack,
                },
              });
            }
          }
        }
      }
      if (!diskCandidates.length) {
        addLog('debug', 'No disk files after scan', {
          sourceId: source.id,
          sourceType: source.type,
          reason: 'no-disk-files',
          totalFiles: files.length,
        });
        setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'No disk files found.' }));
        showNoDiskWarning();
        return false;
      }

      const groupMap = assignDiskGroupsByPrefix(
        diskCandidates.map((entry) => ({ path: normalizeDiskPath(entry.path), name: entry.name })),
      );

      const runtimeFiles: Record<string, File> = {};
      const disks = diskCandidates.map((entry, index) => {
        const normalized = normalizeDiskPath(entry.path);
        const autoGroup = groupMap.get(normalized);
        const fallbackGroup = getLeafFolderName(normalized);
        const groupName = autoGroup ?? fallbackGroup ?? null;
        const localSource = source.type === 'local' ? localSourcesById.get(source.id) : null;
        let localEntry: { uri?: string | null } | null = null;
        if (localSource && getLocalSourceListingMode(localSource) === 'entries') {
          try {
            const entries = requireLocalSourceEntries(localSource, 'HomeDiskManager.localEntry');
            localEntry = entries.find((item) => normalizeSourcePath(item.relativePath) === normalized) ?? null;
          } catch (error) {
            addErrorLog('Local source entries unavailable', {
              sourceId: localSource.id,
              error: {
                name: (error as Error).name,
                message: (error as Error).message,
                stack: (error as Error).stack,
              },
            });
          }
        }
        const diskEntry = createDiskEntry({
          path: normalized,
          location: source.type === 'ultimate' ? 'ultimate' : 'local',
          group: groupName,
          sourceId: source.type === 'local' ? source.id : null,
          localUri: localEntry?.uri ?? null,
          localTreeUri: localSource?.android?.treeUri ?? null,
          sizeBytes: entry.sizeBytes ?? null,
          modifiedAt: entry.modifiedAt ?? null,
          importOrder: index,
        });
        if (source.type === 'local') {
          const runtime = resolveLocalRuntimeFile(source.id, normalized);
          if (runtime) runtimeFiles[diskEntry.id] = runtime;
        }
        return diskEntry;
      });

      const minDuration = addItemsSurface === 'page' ? 800 : 300;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minDuration) {
        await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
      }

      diskLibrary.addDisks(disks, runtimeFiles);
      if (localTreeUri) {
        addLog('debug', 'SAF disk scan complete', {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          totalFiles: files.length,
          supportedFiles: diskCandidates.length,
          elapsedMs: Date.now() - startedAt,
        });
      }
      setAddItemsProgress((prev) => ({ ...prev, status: 'done', message: 'Added to library' }));
      toast({ title: 'Items added', description: `${disks.length} disk(s) added to library.` });
      return true;
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        setAddItemsProgress((prev) => ({ ...prev, status: 'idle', message: 'Scan canceled.' }));
        return false;
      }
      const listingDetails = err instanceof LocalSourceListingError ? err.details : undefined;
      setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'Add items failed' }));
      reportUserError({
        operation: 'DISK_IMPORT',
        title: 'Add items failed',
        description: err.message,
        error: err,
        context: {
          sourceId: source.id,
          sourceType: source.type,
          platform: getPlatform(),
          details: listingDetails,
        },
      });
      return false;
    } finally {
      setIsAddingItems(false);
      addItemsAbortRef.current = null;
      if (addItemsStartedAtRef.current) {
        setAddItemsProgress((prev) => ({
          ...prev,
          elapsedMs: Date.now() - addItemsStartedAtRef.current!,
        }));
      }
      if (addItemsOverlayActiveRef.current) {
        const overlayStartedAt = addItemsOverlayStartedAtRef.current ?? startedAt;
        const minOverlayDuration = 800;
        const overlayElapsed = Date.now() - overlayStartedAt;
        if (overlayElapsed < minOverlayDuration) {
          await new Promise((resolve) => setTimeout(resolve, minOverlayDuration - overlayElapsed));
        }
        setShowAddItemsOverlay(false);
        addItemsOverlayStartedAtRef.current = null;
        addItemsOverlayActiveRef.current = false;
      }
    }
  }), [addItemsSurface, browserOpen, diskLibrary, isAddingItems, localSourcesById, reportUserError, showNoDiskWarning, trace]);

  const handleLocalSourceInput = trace(async (files: FileList | File[] | null) => {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
    const source = addSourceFromFiles(files);
    if (!source) return;
    const fileList = Array.isArray(files) ? files : Array.from(files);
    let success = false;
    try {
      setIsAddingItems(true);
      setAddItemsProgress({ status: 'scanning', count: 0, elapsedMs: 0, total: null, message: 'Scanning…' });
      const normalizedFiles = fileList.map((file) => {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        const relativePath = relative.replace(/^\/+/, '');
        return {
          path: normalizeSourcePath(relativePath),
          name: file.name,
          sizeBytes: file.size ?? null,
          modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
        };
      });
      const diskCandidates = normalizedFiles.filter((entry) => isDiskImagePath(entry.path));
      if (!diskCandidates.length) {
        setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'No disk files found.' }));
        showNoDiskWarning();
      } else {
        const groupMap = assignDiskGroupsByPrefix(
          diskCandidates.map((entry) => ({ path: normalizeDiskPath(entry.path), name: entry.name })),
        );
        const runtimeFiles: Record<string, File> = {};
        const disks = diskCandidates.map((entry, index) => {
          const normalized = normalizeDiskPath(entry.path);
          const autoGroup = groupMap.get(normalized);
          const fallbackGroup = getLeafFolderName(normalized);
          const groupName = autoGroup ?? fallbackGroup ?? null;
          const diskEntry = createDiskEntry({
            path: normalized,
            location: 'local',
            group: groupName,
            sourceId: source.id,
            sizeBytes: entry.sizeBytes ?? null,
            modifiedAt: entry.modifiedAt ?? null,
            importOrder: index,
          });
          const runtime = resolveLocalRuntimeFile(source.id, normalized);
          if (runtime) runtimeFiles[diskEntry.id] = runtime;
          return diskEntry;
        });
        diskLibrary.addDisks(disks, runtimeFiles);
        setAddItemsProgress((prev) => ({ ...prev, status: 'done', message: 'Added to library' }));
        toast({ title: 'Items added', description: `${disks.length} disk(s) added to library.` });
        success = true;
      }
    } catch (error) {
      setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'Add items failed' }));
      reportUserError({
        operation: 'DISK_IMPORT',
        title: 'Add items failed',
        description: (error as Error).message,
        error: error as Error,
      });
    } finally {
      setIsAddingItems(false);
    }
    if (success && browserOpen) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setBrowserOpen(false);
    }
  });

  const handleAddLocalSourceFromPicker = useCallback(trace(async () => {
    const source = await addSourceFromPicker(localSourceInputRef.current);
    if (!source) return null;
    const location = createLocalSourceLocation(source);
    const success = await handleAddDiskSelections(location, [
      { type: 'dir', name: location.name, path: location.rootPath },
    ]);
    if (success && browserOpen) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setBrowserOpen(false);
    }
    return source.id;
  }), [addSourceFromPicker, browserOpen, handleAddDiskSelections, trace]);

  const buildDiskMenuItems = useCallback((disk: DiskEntry, disableActions?: boolean): ActionListMenuItem[] => {
    const detailsDate = disk.modifiedAt || disk.importedAt;
    return [
      { type: 'label', label: 'Details' },
      { type: 'info', label: 'Size', value: formatBytes(disk.sizeBytes) },
      { type: 'info', label: 'Date', value: formatDate(detailsDate) },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Set group…',
        onSelect: () => {
          setGroupDialogDisk(disk);
          setGroupName(disk.group || '');
        },
        disabled: disableActions,
      },
      {
        type: 'action',
        label: 'Rename disk…',
        onSelect: () => {
          setRenameDialogDisk(disk);
          setRenameValue(disk.name || '');
        },
        disabled: disableActions,
      },
      {
        type: 'action',
        label: 'Remove from collection',
        onSelect: () => setDeleteDialogDisk(disk),
        disabled: disableActions,
        destructive: true,
      },
    ];
  }, []);

  const buildDiskListItems = useCallback(
    (disks: DiskEntry[], options?: { showSelection?: boolean; showMenu?: boolean; disableActions?: boolean; onMount?: (disk: DiskEntry) => void }) => {
      let lastFolder: string | null = null;
      return disks.reduce<ActionListItem[]>((acc, disk) => {
        const folderPath = getDiskFolderPath(disk.path);
        if (folderPath !== lastFolder) {
          acc.push({
            id: `folder:${folderPath}`,
            title: folderPath,
            variant: 'header',
            icon: <Folder className="h-3.5 w-3.5" aria-hidden="true" />,
            selected: false,
            actionLabel: '',
            showMenu: false,
            showSelection: false,
            disableActions: true,
          });
          lastFolder = folderPath;
        }
        const groupColor = disk.group ? pickDiskGroupColor(disk.group) : null;
        const groupMeta = disk.group ? (
          <span className="flex items-center gap-1 min-w-0">
            <span className={cn('h-2 w-2 rounded-full border', groupColor?.chip)} aria-hidden="true" />
            <span className={cn(groupColor?.text, 'break-words min-w-0')}>Group: {disk.group}</span>
          </span>
        ) : null;
        acc.push({
          id: disk.id,
          title: disk.name,
          filterText: `${disk.name} ${disk.path} ${disk.group ?? ''}`,
          meta: groupMeta,
          icon: <LocationIcon location={disk.location} />,
          selected: selectedDiskIds.has(disk.id),
          onSelectToggle: (selected) => handleDiskSelect(disk, selected),
          menuItems: buildDiskMenuItems(disk, options?.disableActions),
          disableActions: options?.disableActions,
          actionLabel: 'Mount',
          actionIcon: <HardDrive className="h-4 w-4" aria-hidden="true" />,
          onAction: () => options?.onMount?.(disk),
          onTitleClick: () => options?.onMount?.(disk),
          actionAriaLabel: `Mount ${disk.name}`,
          showSelection: options?.showSelection !== false,
          showMenu: options?.showMenu !== false,
        } as ActionListItem);
        return acc;
      }, []);
    },
    [buildDiskMenuItems, handleDiskSelect, selectedDiskIds],
  );

  const normalizedDriveModel = useMemo(
    () => normalizeDriveDevices(drivesData ?? null),
    [drivesData],
  );
  const softIecDevice = normalizedDriveModel.devices.find((entry) => entry.class === SOFT_IEC_CONTROL.class) ?? null;

  const driveRows = DRIVE_KEYS.map((key) => {
    const info = drivesData?.drives?.find((entry) => entry[key])?.[key];
    const driveConfigPayload = key === 'a' ? driveAConfig : driveBConfig;
    const busId = resolveDriveBusId(key, driveConfigPayload, info);
    const driveType = resolveDriveType(key, driveConfigPayload, info);
    const busOptions = buildBusIdOptions([...DRIVE_BUS_ID_DEFAULTS], busId);
    const driveTypeOptions = buildTypeOptions([...DRIVE_TYPE_DEFAULTS], driveType);
    const powerOverride = drivePowerOverride[key];
    const powerEnabled = powerOverride ?? info?.enabled;
    const hasPowerState = typeof powerEnabled === 'boolean';
    const powerLabel = powerEnabled ? 'Turn Off' : 'Turn On';
    const powerTarget = !powerEnabled;
    const powerPending = Boolean(drivePowerPending[key]);
    const mountedDiskId = resolveMountedDiskId(key);
    const forcedEmpty = mountedByDrive[key] === '';
    const mounted = forcedEmpty ? false : Boolean(info?.image_file || mountedDiskId);
    const mountedDisk = mountedDiskId ? disksById[mountedDiskId] : null;
    const groupSize = mountedDisk?.group
      ? diskLibrary.disks.filter((disk) => disk.group === mountedDisk.group).length
      : 0;
    const canRotate = Boolean(mountedDisk?.group && groupSize > 1);
    const mountedDiskName = forcedEmpty ? null : mountedDisk?.name || info?.image_file || null;
    const mountedLabel = mountedDiskName ? `Mounted disk: ${mountedDiskName}` : 'No disk mounted';

    return {
      key,
      info,
      mounted,
      mountedDisk,
      canRotate,
      mountedLabel,
      busId,
      busOptions,
      driveType,
      driveTypeOptions,
      powerEnabled,
      hasPowerState,
      powerLabel,
      powerTarget,
      powerPending,
      configPending: Boolean(driveConfigPending[key]),
    };
  });

  const softIecBusId = softIecDevice?.busId ?? 11;
  const softIecBusOptions = buildBusIdOptions([8, 9, 10, 11], softIecBusId);
  const softIecType = softIecDevice?.type ?? 'DOS emulation';

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="category-header">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Drives
        </h3>
        <div className="max-w-[180px]">
          <QuickActionCard
            icon={RotateCcw}
            label="Reset Drives"
            compact
            onClick={() => void handleResetDrives()}
            disabled={!status.isConnected || resetDrivesPending}
            loading={resetDrivesPending}
          />
        </div>
        <div className="grid gap-3">
          {driveRows.map(({ key, mounted, mountedDisk, canRotate, mountedLabel, busId, busOptions, driveType, driveTypeOptions, powerEnabled, hasPowerState, powerLabel, powerTarget, powerPending, configPending }) => (
            <div key={key} className="config-card space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{buildDriveLabel(key)}</span>
                  <Select
                    value={String(busId)}
                    onValueChange={(value) =>
                      void handleDriveConfigUpdate(
                        key,
                        DRIVE_BUS_ID_ITEM,
                        Number(value),
                        'Drive Bus ID updated',
                        `${buildDriveLabel(key)} now uses device #${value}.`,
                      )}
                    disabled={!status.isConnected || configPending}
                  >
                    <SelectTrigger
                      className="h-7 w-[86px] px-2 text-xs"
                      aria-label={`${buildDriveLabel(key)} Bus ID`}
                      data-testid={`drive-bus-select-${key}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {busOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          #{option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={driveType}
                    onValueChange={(value) =>
                      void handleDriveConfigUpdate(
                        key,
                        DRIVE_TYPE_ITEM,
                        value,
                        'Drive Type updated',
                        `${buildDriveLabel(key)} switched to ${value} mode.`,
                      )}
                    disabled={!status.isConnected || configPending}
                  >
                    <SelectTrigger
                      className="h-7 w-[90px] px-2 text-xs"
                      aria-label={`${buildDriveLabel(key)} Drive Type`}
                      data-testid={`drive-type-select-${key}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {driveTypeOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${powerEnabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                      }`}
                  >
                    {powerEnabled ? 'ON' : 'OFF'}
                  </span>
                  <DiskIndicator mounted={mounted} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Mounted disk</p>
                  <p className="text-sm font-medium break-words whitespace-normal max-w-full">
                    {mountedLabel}
                  </p>
                  {mountedDisk?.group ? (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground min-w-0">
                      <span
                        className={cn('h-2 w-2 rounded-full border', pickDiskGroupColor(mountedDisk.group).chip)}
                        aria-hidden="true"
                      />
                      <span className={cn(pickDiskGroupColor(mountedDisk.group).text, 'break-words min-w-0')}>
                        Group: {mountedDisk.group}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {mounted && (
                    <Button variant="outline" size="sm" onClick={() => void handleEject(key)} disabled={!status.isConnected || configPending}>
                      Eject
                    </Button>
                  )}
                  <Button variant="default" size="sm" onClick={() => setActiveDrive(key)} disabled={!status.isConnected || configPending}>
                    Mount…
                  </Button>
                </div>
              </div>

              {canRotate && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void handleRotate(key, -1)} disabled={!status.isConnected || configPending}>
                    <ArrowRightLeft className="h-4 w-4 mr-1" />
                    Prev
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleRotate(key, 1)} disabled={!status.isConnected || configPending}>
                    <ArrowLeftRight className="h-4 w-4 mr-1" />
                    Next
                  </Button>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleToggleDrivePower(key, powerTarget)}
                  disabled={!status.isConnected || !hasPowerState || powerPending || configPending}
                  data-testid={`drive-power-toggle-${key}`}
                >
                  {powerLabel}
                </Button>
              </div>

              {driveErrors[key] ? (
                <p className="text-xs text-destructive">{driveErrors[key]}</p>
              ) : null}
            </div>
          ))}
          {softIecDevice ? (
            <div className="config-card space-y-2" data-testid="drive-soft-iec-row">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">Soft IEC Drive</span>
                  <span className="text-xs text-muted-foreground">#{softIecBusId}</span>
                  <span className="text-xs text-muted-foreground">{softIecType}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void handleSoftIecConfigUpdate(
                      'IEC Drive',
                      softIecDevice.enabled ? 'Disabled' : 'Enabled',
                      softIecDevice.enabled ? 'Soft IEC disabled' : 'Soft IEC enabled',
                      softIecDevice.enabled ? 'Soft IEC drive turned off.' : 'Soft IEC drive turned on.',
                    )}
                  disabled={!status.isConnected || softIecConfigPending}
                  data-testid="drive-power-toggle-soft-iec"
                >
                  {softIecDevice.enabled ? 'ON' : 'OFF'}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Bus ID</span>
                  <Select
                    value={String(softIecBusId)}
                    onValueChange={(value) =>
                      void handleSoftIecConfigUpdate(
                        'Soft Drive Bus ID',
                        Number(value),
                        'Soft IEC bus ID updated',
                        `Soft IEC now uses device #${value}.`,
                      )}
                    disabled={!status.isConnected || softIecConfigPending}
                  >
                    <SelectTrigger data-testid="drive-bus-select-soft-iec">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {softIecBusOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          #{option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Type</span>
                  {/* Soft IEC mode changes are not documented via REST/config for this panel, so type is read-only. */}
                  <div className="h-9 rounded-md border border-border/60 bg-background px-3 flex items-center text-xs text-muted-foreground">
                    {softIecType}
                  </div>
                </div>
              </div>
              {softIecDevice.lastError ? (
                <p className="text-xs text-muted-foreground">Service error reported.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="category-header">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Disks
        </h3>

        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <SelectableActionList
            title="Disk list"
            selectionLabel="items"
            items={buildDiskListItems(sortedDisks, {
              onMount: (entry) => {
                if (!status.isConnected) {
                  reportUserError({
                    operation: 'DISK_MOUNT',
                    title: 'Offline',
                    description: 'Connect to mount disks.',
                  });
                  return;
                }
                setActiveDisk(entry);
              },
            })}
            emptyLabel="No disks in the collection yet."
            selectAllLabel="Select all"
            deselectAllLabel="Deselect all"
            removeSelectedLabel={selectedCount ? 'Remove selected items' : undefined}
            selectedCount={selectedCount}
            allSelected={allSelected}
            onToggleSelectAll={toggleSelectAll}
            onRemoveSelected={() => setBulkDeleteOpen(true)}
            maxVisible={listPreviewLimit}
            viewAllTitle="All disks"
            filterPlaceholder="Filter disks..."
            listTestId="disk-list"
            rowTestId="disk-row"
            headerActions={
              <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
                {diskLibrary.disks.length ? 'Add more disks' : 'Add disks'}
              </Button>
            }
          />
        </div>
      </section>

      <input
        ref={localSourceInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={wrapUserEvent((event) => {
          const selected = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
          void handleLocalSourceInput(selected.length ? selected : null);
          event.currentTarget.value = '';
        }, 'upload', 'FileInput', { type: 'file' }, 'FileInput')}
      />

      <Dialog open={Boolean(activeDrive)} onOpenChange={(open) => !open && setActiveDrive(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mount disk to {activeDrive ? buildDriveLabel(activeDrive) : ''}</DialogTitle>
            <DialogDescription>Select a disk to mount in this drive.</DialogDescription>
          </DialogHeader>
          <SelectableActionList
            title="Available disks"
            items={buildDiskListItems(sortedDisks, {
              showSelection: false,
              showMenu: false,
              disableActions: !status.isConnected,
              onMount: (entry) => {
                if (!activeDrive) return;
                void handleMountDisk(activeDrive, entry).finally(() => setActiveDrive(null));
              },
            })}
            emptyLabel="No disks in the collection yet."
            selectedCount={0}
            allSelected={false}
            onToggleSelectAll={() => undefined}
            maxVisible={listPreviewLimit}
            viewAllTitle="All disks"
            showSelectionControls={false}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(activeDisk)} onOpenChange={(open) => !open && setActiveDisk(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mount {activeDisk?.name}</DialogTitle>
            <DialogDescription>Select the drive to mount this disk.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {driveRows.map(({ key, busId, driveType, mounted, configPending }) => (
              <Button
                key={key}
                variant="outline"
                onClick={() => {
                  if (!activeDisk) return;
                  void handleMountDisk(key, activeDisk).finally(() => setActiveDisk(null));
                }}
                disabled={!status.isConnected || configPending}
              >
                <HardDrive className="h-4 w-4 mr-2" />
                {buildDriveLabel(key)} (#{busId}, {driveType}) {mounted ? '• mounted' : ''}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ItemSelectionDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        title="Add items"
        confirmLabel="Add to library"
        sourceGroups={sourceGroups}
        onAddLocalSource={handleAddLocalSourceFromPicker}
        onConfirm={handleAddDiskSelections}
        filterEntry={(entry) => entry.type === 'dir' || isDiskImagePath(entry.path)}
        allowFolderSelection
        isConfirming={isAddingItems}
        progress={addItemsProgress}
        showProgressFooter={addItemsSurface === 'dialog'}
        autoConfirmCloseBefore={isAndroid}
        onAutoConfirmStart={handleAutoConfirmStart}
        autoConfirmLocalSource={false}
        onCancelScan={cancelAddItemsScan}
      />

      {!browserOpen ? (
        <AddItemsProgressOverlay
          progress={addItemsProgress}
          title="Adding disks"
          testId="add-disks-overlay"
          visible={showAddItemsOverlay || addItemsProgress.status === 'scanning'}
          onCancel={cancelAddItemsScan}
        />
      ) : null}

      <Dialog open={Boolean(groupDialogDisk)} onOpenChange={(open) => !open && setGroupDialogDisk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set group</DialogTitle>
            <DialogDescription>Assign a group label for disk rotation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {groupOptions.length ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Existing groups</p>
                <div className="flex flex-wrap gap-2">
                  {groupOptions.map((option) => (
                    <Button
                      key={option.name}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!groupDialogDisk) return;
                        diskLibrary.updateDiskGroup(groupDialogDisk.id, option.name);
                        setGroupDialogDisk(null);
                      }}
                      className="flex items-center gap-2"
                    >
                      <span className={cn('h-2 w-2 rounded-full border', option.color.chip)} aria-hidden="true" />
                      <span className={cn(option.color.text, 'max-w-[180px] break-words whitespace-normal')}>
                        {option.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">({option.count})</span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">New group</p>
              <Input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Enter a group name"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && groupDialogDisk) {
                    const nextName = groupName.trim();
                    if (!nextName) return;
                    diskLibrary.updateDiskGroup(groupDialogDisk.id, nextName);
                    setGroupDialogDisk(null);
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="default"
              onClick={() => {
                if (!groupDialogDisk) return;
                const nextName = groupName.trim();
                diskLibrary.updateDiskGroup(groupDialogDisk.id, nextName || null);
                setGroupDialogDisk(null);
              }}
            >
              {groupName.trim() ? 'Create & assign' : 'Clear group'}
            </Button>
            <Button variant="ghost" onClick={() => setGroupDialogDisk(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameDialogDisk)} onOpenChange={(open) => !open && setRenameDialogDisk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename disk</DialogTitle>
            <DialogDescription>Update the display name for this disk.</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          <DialogFooter>
            <Button
              variant="default"
              onClick={() => {
                if (!renameDialogDisk) return;
                diskLibrary.updateDiskName(renameDialogDisk.id, renameValue || renameDialogDisk.name);
                setRenameDialogDisk(null);
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setRenameDialogDisk(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteDialogDisk)} onOpenChange={(open) => !open && setDeleteDialogDisk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove disk?</DialogTitle>
            <DialogDescription>
              This removes the disk from your collection. The original file is not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!deleteDialogDisk) return;
                void handleDeleteDisk(deleteDialogDisk);
                setDeleteDialogDisk(null);
              }}
            >
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setDeleteDialogDisk(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove selected disks?</DialogTitle>
            <DialogDescription>
              {selectedCount
                ? `This removes ${selectedCount} disk(s) from your collection. Files are not deleted.`
                : 'No disks selected.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleBulkDelete()} disabled={!selectedCount}>
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
