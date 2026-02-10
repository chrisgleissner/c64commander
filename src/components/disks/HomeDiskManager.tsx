/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
import { mountDiskToDrive } from '@/lib/disks/diskMount';
import { getOnOffButtonClass } from '@/lib/ui/buttonStyles';
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
const SOFT_IEC_DEFAULT_PATH_ITEM = 'Default Path';
const SOFT_IEC_DEFAULT_PATH_FALLBACK = '/USB0/';
const SOFT_IEC_BUS_ID_DEFAULTS = Array.from({ length: 23 }, (_, index) => index + 8);
const ROW1_CONTROL_CLASS = 'h-9 w-14 rounded-md px-0 text-xs font-semibold';
const INLINE_META_SELECT_CLASS = 'h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none focus:ring-1 focus:ring-ring data-[state=open]:border-border data-[state=open]:bg-background';
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

const normalizeDirectoryPath = (value: string) => {
  const normalized = normalizeSourcePath(value || '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
};

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
  const [driveResetPending, setDriveResetPending] = useState<Record<string, boolean>>({});
  const [browserOpen, setBrowserOpen] = useState(false);
  const [softIecDirectoryBrowserOpen, setSoftIecDirectoryBrowserOpen] = useState(false);
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
  const { data: softIecConfig } = useC64ConfigItems(
    SOFT_IEC_CONTROL.category,
    [SOFT_IEC_CONTROL.busItem, SOFT_IEC_DEFAULT_PATH_ITEM],
    status.isConnected || status.isConnecting,
  );

  const normalizedDriveModel = useMemo(
    () => normalizeDriveDevices(drivesData ?? null),
    [drivesData],
  );
  const softIecDevice = normalizedDriveModel.devices.find((entry) => entry.class === SOFT_IEC_CONTROL.class) ?? null;

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
  const softIecDirectorySourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    return [{ label: 'C64 Ultimate', sources: [ultimateSource] }];
  }, []);

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
      const actualStates: Record<string, boolean | undefined> = {
        a: normalizedDriveModel.devices.find((entry) => entry.class === 'PHYSICAL_DRIVE_A')?.enabled,
        b: normalizedDriveModel.devices.find((entry) => entry.class === 'PHYSICAL_DRIVE_B')?.enabled,
        softiec: normalizedDriveModel.devices.find((entry) => entry.class === SOFT_IEC_CONTROL.class)?.enabled,
      };
      Object.entries(actualStates).forEach(([key, actual]) => {
        if (typeof actual !== 'boolean') return;
        if (next[key] !== undefined && next[key] === actual) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [drivesData?.drives, normalizedDriveModel.devices]);

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

  const handleToggleDrivePower = trace(async (
    driveKey: string,
    driveLabel: string,
    targetEnabled: boolean,
    errorKey: string,
  ) => {
    if (!status.isConnected) return;
    setDrivePowerPending((prev) => ({ ...prev, [errorKey]: true }));
    setDrivePowerOverride((prev) => ({ ...prev, [errorKey]: targetEnabled }));
    try {
      if (targetEnabled) {
        await api.driveOn(driveKey);
      } else {
        await api.driveOff(driveKey);
      }
      setDriveErrors((prev) => ({ ...prev, [errorKey]: '' }));
      toast({
        title: targetEnabled ? 'Drive powered on' : 'Drive powered off',
        description: `${driveLabel} ${targetEnabled ? 'enabled' : 'disabled'}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['c64-drives'] });
    } catch (error) {
      setDrivePowerOverride((prev) => {
        const next = { ...prev };
        delete next[errorKey];
        return next;
      });
      setDriveErrors((prev) => ({ ...prev, [errorKey]: (error as Error).message }));
      reportUserError({
        operation: 'DRIVE_POWER',
        title: 'Drive power toggle failed',
        description: (error as Error).message,
        error,
        context: { driveKey, driveLabel, targetEnabled },
      });
    } finally {
      setDrivePowerPending((prev) => ({ ...prev, [errorKey]: false }));
    }
  });

  const handleResetDrive = trace(async (driveKey: string, driveLabel: string, errorKey: string) => {
    if (!status.isConnected || driveResetPending[errorKey]) return;
    setDriveResetPending((prev) => ({ ...prev, [errorKey]: true }));
    try {
      await api.resetDrive(driveKey);
      await refreshDrivesFromDevice();
      setDriveErrors((prev) => ({ ...prev, [errorKey]: '' }));
      toast({
        title: `${driveLabel} reset`,
        description: `${driveLabel} was reset.`,
      });
    } catch (error) {
      setDriveErrors((prev) => ({ ...prev, [errorKey]: (error as Error).message }));
      reportUserError({
        operation: 'RESET_DRIVES',
        title: 'Drive reset failed',
        description: (error as Error).message,
        error,
        context: { driveKey, driveLabel },
      });
    } finally {
      setDriveResetPending((prev) => ({ ...prev, [errorKey]: false }));
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

  const getCategoryConfigValue = (payload: unknown, categoryName: string, itemName: string) => {
    const record = payload as Record<string, unknown> | undefined;
    const categoryBlock = record?.[categoryName] as Record<string, unknown> | undefined;
    const itemsBlock = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
    if (!itemsBlock || !Object.prototype.hasOwnProperty.call(itemsBlock, itemName)) return undefined;
    return normalizeConfigItem(itemsBlock[itemName]).value;
  };

  const getDriveConfigValue = (payload: unknown, drive: DriveKey, itemName: string) =>
    getCategoryConfigValue(payload, DRIVE_CONFIG_CATEGORY[drive], itemName);

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

  const resolveSoftIecDefaultPath = (payload: unknown, fallbackPath?: string | null) => {
    const fromConfig = String(
      getCategoryConfigValue(payload, SOFT_IEC_CONTROL.category, SOFT_IEC_DEFAULT_PATH_ITEM)
      ?? '',
    ).trim();
    if (fromConfig.length) return normalizeDirectoryPath(fromConfig);
    if (fallbackPath && fallbackPath.trim()) return normalizeDirectoryPath(fallbackPath);
    return SOFT_IEC_DEFAULT_PATH_FALLBACK;
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
    itemName: 'IEC Drive' | 'Soft Drive Bus ID' | 'Default Path',
    value: string | number,
    successTitle: string,
    successDescription: string,
  ) => {
    if (!status.isConnected) return false;
    setSoftIecConfigPending(true);
    try {
      await withRetry(
        `Soft IEC ${itemName} update`,
        () => api.setConfigValue(SOFT_IEC_CONTROL.category, itemName, value),
      );
      setDriveErrors((prev) => ({ ...prev, softiec: '' }));
      toast({ title: successTitle, description: successDescription });
      await Promise.all([
        refreshDrivesFromDevice(),
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey)
            && query.queryKey[0] === 'c64-config-items'
            && query.queryKey[1] === SOFT_IEC_CONTROL.category,
        }),
      ]);
      return true;
    } catch (error) {
      setDriveErrors((prev) => ({ ...prev, softiec: (error as Error).message }));
      reportUserError({
        operation: 'SOFT_IEC_CONFIG_UPDATE',
        title: 'Soft IEC setting update failed',
        description: (error as Error).message,
        error,
        context: { itemName, value },
      });
      return false;
    } finally {
      setSoftIecConfigPending(false);
    }
  });

  const handleSoftIecDirectorySelect = trace(async (source: SourceLocation, selections: SelectedItem[]) => {
    if (!status.isConnected) {
      reportUserError({
        operation: 'SOFT_IEC_CONFIG_UPDATE',
        title: 'Offline',
        description: 'Connect to select a default directory.',
      });
      return false;
    }
    if (source.type !== 'ultimate') {
      reportUserError({
        operation: 'SOFT_IEC_CONFIG_UPDATE',
        title: 'Unsupported source',
        description: 'Default Path must be selected from C64 Ultimate storage.',
      });
      return false;
    }

    const directorySelection = selections.find((selection) => selection.type === 'dir');
    if (!directorySelection) {
      reportUserError({
        operation: 'SOFT_IEC_CONFIG_UPDATE',
        title: 'Select directory',
        description: 'Choose a folder. File selection is not supported for Default Path.',
      });
      return false;
    }

    const directoryPath = normalizeDirectoryPath(directorySelection.path);
    return handleSoftIecConfigUpdate(
      SOFT_IEC_DEFAULT_PATH_ITEM,
      directoryPath,
      'Soft IEC default path updated',
      `Default Path set to ${directoryPath}`,
    );
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
    const mountedLabel = mountedDiskName ?? 'No disk mounted';

    return {
      key,
      driveLabel: buildDriveLabel(key),
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
      resetPending: Boolean(driveResetPending[key]),
      errorMessage: driveErrors[key] || '',
    };
  });

  const softIecConfigBusId = parseBusId(getCategoryConfigValue(softIecConfig, SOFT_IEC_CONTROL.category, SOFT_IEC_CONTROL.busItem));
  const softIecBusId = softIecConfigBusId ?? softIecDevice?.busId ?? 11;
  const softIecBusOptions = buildBusIdOptions([...SOFT_IEC_BUS_ID_DEFAULTS], softIecBusId);
  const softIecDefaultPath = resolveSoftIecDefaultPath(
    softIecConfig,
    softIecDevice?.partitions?.[0]?.path ?? null,
  );
  const softIecMounted = Boolean(softIecDevice?.imageFile);
  const softIecMountedLabel = softIecDevice?.imageFile ?? 'No disk mounted';
  const softIecPowerEnabled = drivePowerOverride.softiec ?? softIecDevice?.enabled ?? false;
  const softIecHasPowerState = typeof softIecPowerEnabled === 'boolean';
  const softIecPowerLabel = softIecPowerEnabled ? 'Turn Off' : 'Turn On';
  const softIecPowerTarget = !softIecPowerEnabled;
  const softIecResetPending = Boolean(driveResetPending.softiec);
  const softIecPowerPending = Boolean(drivePowerPending.softiec);
  const softIecEndpointKey = softIecDevice?.endpointKey ?? 'softiec';
  const softIecErrorMessage = driveErrors.softiec || (softIecDevice?.lastError ? 'Service error reported.' : '');

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="category-header">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Drives
        </h3>
        <div className="grid gap-3">
          {driveRows.map(({ key, driveLabel, mounted, mountedDisk, canRotate, mountedLabel, busId, busOptions, driveType, driveTypeOptions, powerEnabled, hasPowerState, powerLabel, powerTarget, powerPending, configPending, resetPending, errorMessage }) => (
            <div key={key} className="config-card space-y-2" data-testid={`drive-card-${key}`}>
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">{driveLabel}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(ROW1_CONTROL_CLASS, getOnOffButtonClass(powerEnabled))}
                    onClick={() => void handleToggleDrivePower(key, driveLabel, powerTarget, key)}
                    disabled={!status.isConnected || !hasPowerState || powerPending || configPending}
                    data-testid={`drive-status-toggle-${key}`}
                  >
                    {powerEnabled ? 'ON' : 'OFF'}
                  </Button>
                  <Button
                    variant={mounted ? 'secondary' : 'outline'}
                    size="sm"
                    className={ROW1_CONTROL_CLASS}
                    onClick={() => {
                      if (mounted) {
                        void handleEject(key);
                      } else {
                        setActiveDrive(key);
                      }
                    }}
                    disabled={!status.isConnected || configPending}
                    data-testid={`drive-mount-toggle-${key}`}
                    aria-label={`${driveLabel} ${mounted ? 'Eject disk' : 'Mount disk'}`}
                  >
                    <Disc className={cn('h-4 w-4', mounted ? 'text-success' : 'text-muted-foreground')} />
                  </Button>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                <span className="shrink-0">Bus ID</span>
                <Select
                  value={String(busId)}
                  onValueChange={(value) =>
                    void handleDriveConfigUpdate(
                      key,
                      DRIVE_BUS_ID_ITEM,
                      Number(value),
                      'Drive Bus ID updated',
                      `${driveLabel} now uses device #${value}.`,
                    )}
                  disabled={!status.isConnected || configPending}
                >
                  <SelectTrigger
                    className={cn(INLINE_META_SELECT_CLASS, 'w-[76px] min-w-[76px]')}
                    aria-label={`${driveLabel} Bus ID`}
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
                <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">•</span>
                <span className="shrink-0">Drive Type</span>
                <Select
                  value={driveType}
                  onValueChange={(value) =>
                    void handleDriveConfigUpdate(
                      key,
                      DRIVE_TYPE_ITEM,
                      value,
                      'Drive Type updated',
                      `${driveLabel} switched to ${value} mode.`,
                    )}
                  disabled={!status.isConnected || configPending}
                >
                  <SelectTrigger
                    className={cn(INLINE_META_SELECT_CLASS, 'w-[80px] min-w-[80px]')}
                    aria-label={`${driveLabel} Drive Type`}
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

              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-xs text-muted-foreground">{mountedLabel}</p>
                  {mountedDisk?.group ? (
                    <span className={cn('h-2 w-2 shrink-0 rounded-full border', pickDiskGroupColor(mountedDisk.group).chip)} aria-hidden="true" />
                  ) : null}
                  {mountedDisk?.group ? (
                    <span className={cn(pickDiskGroupColor(mountedDisk.group).text, 'truncate text-[11px]')}>{mountedDisk.group}</span>
                  ) : null}
                  {canRotate ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => void handleRotate(key, -1)}
                        disabled={!status.isConnected || configPending}
                        aria-label={`${driveLabel} previous disk`}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => void handleRotate(key, 1)}
                        disabled={!status.isConnected || configPending}
                        aria-label={`${driveLabel} next disk`}
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => void handleResetDrive(key, driveLabel, key)}
                    disabled={!status.isConnected || resetPending || configPending}
                    aria-label={`Reset ${driveLabel}`}
                    data-testid={`drive-reset-${key}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => void handleToggleDrivePower(key, driveLabel, powerTarget, key)}
                    disabled={!status.isConnected || !hasPowerState || powerPending || configPending}
                    data-testid={`drive-power-toggle-${key}`}
                  >
                    {powerLabel}
                  </Button>
                </div>
              </div>

              {errorMessage ? (
                <p className="text-xs text-destructive">{errorMessage}</p>
              ) : null}
            </div>
          ))}

          <div className="config-card space-y-2" data-testid="drive-soft-iec-row">
            <div className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold">Soft IEC Drive</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(ROW1_CONTROL_CLASS, getOnOffButtonClass(softIecPowerEnabled))}
                  onClick={() =>
                    void handleSoftIecConfigUpdate(
                      'IEC Drive',
                      softIecPowerEnabled ? 'Disabled' : 'Enabled',
                      softIecPowerEnabled ? 'Soft IEC disabled' : 'Soft IEC enabled',
                      softIecPowerEnabled ? 'Soft IEC drive turned off.' : 'Soft IEC drive turned on.',
                    )}
                  disabled={!status.isConnected || !softIecHasPowerState || softIecConfigPending}
                  data-testid="drive-status-toggle-soft-iec"
                >
                  {softIecPowerEnabled ? 'ON' : 'OFF'}
                </Button>
                <Button
                  variant={softIecMounted ? 'secondary' : 'outline'}
                  size="sm"
                  className={ROW1_CONTROL_CLASS}
                  onClick={() => setSoftIecDirectoryBrowserOpen(true)}
                  disabled={!status.isConnected || softIecConfigPending}
                  data-testid="drive-mount-toggle-soft-iec"
                  aria-label="Soft IEC Drive select directory"
                >
                  <Disc className={cn('h-4 w-4', softIecMounted ? 'text-success' : 'text-muted-foreground')} />
                </Button>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
              <span className="shrink-0">Bus ID</span>
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
                <SelectTrigger
                  className={cn(INLINE_META_SELECT_CLASS, 'w-[76px] min-w-[76px]')}
                  data-testid="drive-bus-select-soft-iec"
                >
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
              <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">•</span>
              <span className="shrink-0">Default Path</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 min-w-0 max-w-full justify-start px-1.5 text-xs font-medium"
                onClick={() => setSoftIecDirectoryBrowserOpen(true)}
                disabled={!status.isConnected || softIecConfigPending}
                data-testid="drive-default-path-select-soft-iec"
                aria-label="Select directory for Soft IEC Default Path"
              >
                <span className="truncate">Select directory ({softIecDefaultPath})</span>
              </Button>
            </div>

            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{softIecMountedLabel}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => void handleResetDrive(softIecEndpointKey, 'Soft IEC Drive', 'softiec')}
                  disabled={!status.isConnected || softIecResetPending || softIecConfigPending}
                  aria-label="Reset Soft IEC Drive"
                  data-testid="drive-reset-soft-iec"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => void handleToggleDrivePower(softIecEndpointKey, 'Soft IEC Drive', softIecPowerTarget, 'softiec')}
                  disabled={!status.isConnected || !softIecHasPowerState || softIecPowerPending || softIecConfigPending}
                  data-testid="drive-power-toggle-soft-iec"
                >
                  {softIecPowerLabel}
                </Button>
              </div>
            </div>

            {softIecErrorMessage ? (
              <p className="text-xs text-destructive">{softIecErrorMessage}</p>
            ) : null}
          </div>
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
      <ItemSelectionDialog
        open={softIecDirectoryBrowserOpen}
        onOpenChange={setSoftIecDirectoryBrowserOpen}
        title="Soft IEC Default Path"
        confirmLabel="Select directory"
        sourceGroups={softIecDirectorySourceGroups}
        onAddLocalSource={async () => null}
        onConfirm={handleSoftIecDirectorySelect}
        filterEntry={() => false}
        allowFolderSelection
        isConfirming={softIecConfigPending}
        autoConfirmLocalSource={false}
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
