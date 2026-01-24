import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Disc, ArrowLeftRight, ArrowRightLeft, HardDrive, X, Monitor, Smartphone, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SelectableActionList, type ActionListItem, type ActionListMenuItem } from '@/components/lists/SelectableActionList';
import { AddItemsProgressOverlay, type AddItemsProgressState } from '@/components/itemSelection/AddItemsProgressOverlay';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { toast } from '@/hooks/use-toast';
import { useC64Connection, useC64Drives } from '@/hooks/useC64Connection';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { useLocalSources } from '@/hooks/useLocalSources';
import { getC64API } from '@/lib/c64api';
import { addErrorLog, addLog } from '@/lib/logging';
import { cn } from '@/lib/utils';
import { mountDiskToDrive } from '@/lib/disks/diskMount';
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
import { getPlatform } from '@/lib/native/platform';
import { redactTreeUri } from '@/lib/native/safUtils';

const DRIVE_KEYS = ['a', 'b'] as const;

type DriveKey = (typeof DRIVE_KEYS)[number];

const buildDriveLabel = (key: DriveKey) => `Drive ${key.toUpperCase()}`;

const buildDrivePath = (path?: string | null, file?: string | null) => {
  if (!file) return null;
  const base = normalizeDiskPath(path || '/');
  return base.endsWith('/') ? `${base}${file}` : `${base}/${file}`;
};

const DiskIndicator = ({ mounted }: { mounted: boolean }) => (
  <Disc className={`h-4 w-4 ${mounted ? 'text-success' : 'text-muted-foreground'}`} />
);

const LocationIcon = ({ location }: { location: DiskEntry['location'] }) =>
  location === 'local' ? (
    <Smartphone className="h-4 w-4 text-primary/70" aria-label="Local disk" />
  ) : (
    <Monitor className="h-4 w-4 text-blue-500/70" aria-label="C64U disk" />
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
  const [browserOpen, setBrowserOpen] = useState(false);
  const [addItemsProgress, setAddItemsProgress] = useState<AddItemsProgressState>({
    status: 'idle',
    count: 0,
    elapsedMs: 0,
    total: null,
    message: null,
  });
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
  const isAndroid = getPlatform() === 'android';

  const api = getC64API();
  const queryClient = useQueryClient();

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
    toast({
      title: 'No disks found',
      description: 'Found no disk file.',
      variant: 'destructive',
    });
  }, []);

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

  const handleLocalSourceInput = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    addSourceFromFiles(files);
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
  const filterText = diskLibrary.filter.trim().toLowerCase();
  const sortedDisks = useMemo(
    () => diskLibrary.disks.slice().sort((a, b) => a.path.localeCompare(b.path)),
    [diskLibrary.disks],
  );
  const matchesFilter = useCallback(
    (disk: DiskEntry) => {
      if (!filterText) return true;
      const name = disk.name.toLowerCase();
      const path = disk.path.toLowerCase();
      const group = disk.group?.toLowerCase() ?? '';
      return name.includes(filterText) || path.includes(filterText) || group.includes(filterText);
    },
    [filterText],
  );

  const handleMountDisk = async (drive: DriveKey, disk: DiskEntry) => {
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
      toast({
        title: 'Mount failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleEject = async (drive: DriveKey) => {
    try {
      await api.unmountDrive(drive);
      setMountedByDrive((prev) => ({ ...prev, [drive]: '' }));
      setDriveErrors((prev) => ({ ...prev, [drive]: '' }));
      toast({ title: 'Disk ejected', description: `${buildDriveLabel(drive)} cleared` });
    } catch (error) {
      setDriveErrors((prev) => ({ ...prev, [drive]: (error as Error).message }));
      toast({
        title: 'Eject failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleToggleDrivePower = async (drive: DriveKey, targetEnabled: boolean) => {
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
      toast({
        title: 'Drive power toggle failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setDrivePowerPending((prev) => ({ ...prev, [drive]: false }));
    }
  };

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

  const handleRotate = async (drive: DriveKey, direction: 1 | -1) => {
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
  };

  const handleDeleteDisk = async (disk: DiskEntry, options: { suppressToast?: boolean } = {}) => {
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
  };

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

  const handleAddDiskSelections = useCallback(async (source: SourceLocation, selections: SelectedItem[]) => {
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

      const collectRecursive = async (rootPath: string) => {
        const queue = [rootPath];
        const visited = new Set<string>();
        const files: SourceEntry[] = [];
        const maxConcurrent = 3;
        const pending = new Set<Promise<void>>();

        const processPath = async (path: string) => {
          if (!path || visited.has(path)) return;
          visited.add(path);
          const entries = await source.listEntries(path);
          entries.forEach((entry) => {
            if (entry.type === 'dir') {
              queue.push(entry.path);
            } else {
              files.push(entry);
            }
          });
          updateProgress(entries.filter((entry) => entry.type === 'file').length);
        };

        while (queue.length || pending.size) {
          while (queue.length && pending.size < maxConcurrent) {
            const nextPath = queue.shift();
            if (!nextPath) continue;
            const job = processPath(nextPath).finally(() => pending.delete(job));
            pending.add(job);
          }
          if (pending.size) {
            await Promise.race(pending);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        return files;
      };

      const files: Array<{ path: string; name: string; sizeBytes?: number | null; modifiedAt?: string | null; sourceId?: string | null }> = [];
      for (const selection of selections) {
        if (selection.type === 'dir') {
          const nested = await collectRecursive(selection.path);
          nested.forEach((entry) => {
            if (entry.type !== 'file') return;
            files.push({ path: entry.path, name: entry.name, sizeBytes: entry.sizeBytes, modifiedAt: entry.modifiedAt, sourceId: source.id });
          });
        } else {
          const entryPath = normalizeSourcePath(selection.path);
          files.push({ path: entryPath, name: selection.name, sourceId: source.id });
          updateProgress(1);
        }
      }

      const diskCandidates = files.filter((entry) => isDiskImagePath(entry.path));
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
      const listingDetails = err instanceof LocalSourceListingError ? err.details : undefined;
      addErrorLog('Add items failed', {
        sourceId: source.id,
        sourceType: source.type,
        platform: getPlatform(),
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
        details: listingDetails,
      });
      setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'Add items failed' }));
      toast({
        title: 'Add items failed',
        description: err.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsAddingItems(false);
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
  }, [addItemsSurface, browserOpen, diskLibrary, localSourcesById, showNoDiskWarning]);

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
        const matches = matchesFilter(disk);
        const isDimmed = filterText.length > 0 && !matches;
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
          meta: groupMeta,
          icon: <LocationIcon location={disk.location} />,
          selected: selectedDiskIds.has(disk.id),
          onSelectToggle: (selected) => handleDiskSelect(disk, selected),
          menuItems: buildDiskMenuItems(disk, options?.disableActions),
          isDimmed,
          disableActions: options?.disableActions,
          actionLabel: 'Mount',
          onAction: () => options?.onMount?.(disk),
          onTitleClick: () => options?.onMount?.(disk),
          actionAriaLabel: `Mount ${disk.name}`,
          showSelection: options?.showSelection !== false,
          showMenu: options?.showMenu !== false,
        } as ActionListItem);
        return acc;
      }, []);
    },
    [buildDiskMenuItems, filterText.length, handleDiskSelect, matchesFilter, selectedDiskIds],
  );

  const driveRows = DRIVE_KEYS.map((key) => {
    const info = drivesData?.drives?.find((entry) => entry[key])?.[key];
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
    const mountedLabel = forcedEmpty ? '--' : mountedDisk?.name || info?.image_file || '--';

    return {
      key,
      info,
      mounted,
      mountedDisk,
      canRotate,
      mountedLabel,
      powerEnabled,
      hasPowerState,
      powerLabel,
      powerTarget,
      powerPending,
    };
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="category-header">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Drives
        </h3>
        <div className="grid gap-3">
          {driveRows.map(({ key, info, mounted, mountedDisk, canRotate, mountedLabel, powerEnabled, hasPowerState, powerLabel, powerTarget, powerPending }) => (
            <div key={key} className="config-card space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm">{buildDriveLabel(key)}</span>
                  <span className="text-xs text-muted-foreground">#{info?.bus_id ?? '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      powerEnabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
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
                  <p className="text-sm font-medium truncate max-w-full">
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
                    <Button variant="outline" size="sm" onClick={() => void handleEject(key)} disabled={!status.isConnected}>
                      Eject
                    </Button>
                  )}
                  <Button variant="default" size="sm" onClick={() => setActiveDrive(key)} disabled={!status.isConnected}>
                    Mount…
                  </Button>
                </div>
              </div>

              {canRotate && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void handleRotate(key, -1)} disabled={!status.isConnected}>
                    <ArrowRightLeft className="h-4 w-4 mr-1" />
                    Prev
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleRotate(key, 1)} disabled={!status.isConnected}>
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
                  disabled={!status.isConnected || !hasPowerState || powerPending}
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
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="category-header">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Disks
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              placeholder="Filter disks…"
              value={diskLibrary.filter}
              onChange={(event) => diskLibrary.setFilter(event.target.value)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => diskLibrary.setFilter('')}
              aria-label="Clear filter"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <SelectableActionList
          title="Disk list"
          selectionLabel="items"
          items={buildDiskListItems(sortedDisks, {
            onMount: (entry) => {
              if (!status.isConnected) {
                toast({ title: 'Offline', description: 'Connect to mount disks.', variant: 'destructive' });
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
          listTestId="disk-list"
          rowTestId="disk-row"
        />

        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => setBrowserOpen(true)}>
            {diskLibrary.disks.length ? 'Add more items' : 'Add items'}
          </Button>
        </div>
      </section>

      <input
        ref={localSourceInputRef}
        type="file"
        multiple
        className="hidden"
          onChange={(event) => {
            handleLocalSourceInput(event.target.files);
            event.currentTarget.value = '';
          }}
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
            {driveRows.map(({ key, info, mounted }) => (
              <Button
                key={key}
                variant="outline"
                onClick={() => {
                  if (!activeDisk) return;
                  void handleMountDisk(key, activeDisk).finally(() => setActiveDisk(null));
                }}
                disabled={!status.isConnected}
              >
                <HardDrive className="h-4 w-4 mr-2" />
                {buildDriveLabel(key)} (#{info?.bus_id ?? '—'}) {mounted ? '• mounted' : ''}
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
        onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
        onConfirm={handleAddDiskSelections}
        filterEntry={(entry) => entry.type === 'dir' || isDiskImagePath(entry.path)}
        allowFolderSelection
        isConfirming={isAddingItems}
        progress={addItemsProgress}
        showProgressFooter={addItemsSurface === 'dialog'}
        autoConfirmCloseBefore={isAndroid}
        onAutoConfirmStart={handleAutoConfirmStart}
        autoConfirmLocalSource
      />

      {!browserOpen ? (
        <AddItemsProgressOverlay
          progress={addItemsProgress}
          title="Adding disks"
          testId="add-disks-overlay"
          visible={showAddItemsOverlay || addItemsProgress.status === 'scanning'}
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
                      <span className={cn(option.color.text, 'truncate max-w-[180px]')}>
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
