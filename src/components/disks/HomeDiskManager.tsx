import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Disc, ArrowLeftRight, ArrowRightLeft, HardDrive, X, Monitor, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SelectableActionList, type ActionListItem, type ActionListMenuItem } from '@/components/lists/SelectableActionList';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { toast } from '@/hooks/use-toast';
import { useC64Connection, useC64Drives } from '@/hooks/useC64Connection';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { useLocalSources } from '@/hooks/useLocalSources';
import { getC64API } from '@/lib/c64api';
import { addErrorLog } from '@/lib/logging';
import { mountDiskToDrive } from '@/lib/disks/diskMount';
import { createDiskEntry, getLeafFolderName, isDiskImagePath, normalizeDiskPath, type DiskEntry } from '@/lib/disks/diskTypes';
import { useDiskLibrary } from '@/hooks/useDiskLibrary';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { createLocalSourceLocation, resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { prepareDirectoryInput } from '@/lib/sourceNavigation/localSourcesStore';
import type { SelectedItem, SourceLocation } from '@/lib/sourceNavigation/types';

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
  const [browserOpen, setBrowserOpen] = useState(false);
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

  const api = getC64API();

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
    prepareDirectoryInput(localSourceInputRef.current);
  }, []);

  const showNoDiskWarning = () => {
    toast({
      title: 'No disks found',
      description: 'Found no disk file.',
      variant: 'destructive',
    });
  };

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
      const files: Array<{ path: string; name: string; sizeBytes?: number | null; modifiedAt?: string | null; sourceId?: string | null }> = [];
      for (const selection of selections) {
        if (selection.type === 'dir') {
          const nested = await source.listFilesRecursive(selection.path);
          nested.forEach((entry) => {
            if (entry.type !== 'file') return;
            files.push({ path: entry.path, name: entry.name, sizeBytes: entry.sizeBytes, modifiedAt: entry.modifiedAt, sourceId: source.id });
          });
        } else {
          const entryPath = normalizeSourcePath(selection.path);
          files.push({ path: entryPath, name: selection.name, sourceId: source.id });
        }
      }

      const diskCandidates = files.filter((entry) => isDiskImagePath(entry.path));
      if (!diskCandidates.length) {
        showNoDiskWarning();
        return false;
      }

      const runtimeFiles: Record<string, File> = {};
      const disks = diskCandidates.map((entry, index) => {
        const normalized = normalizeDiskPath(entry.path);
        const groupName = getLeafFolderName(normalized);
        const localSource = source.type === 'local' ? localSourcesById.get(source.id) : null;
        const localEntry = localSource?.entries.find((item) => normalizeSourcePath(item.relativePath) === normalized);
        const diskEntry = createDiskEntry({
          path: normalized,
          location: source.type === 'ultimate' ? 'ultimate' : 'local',
          group: groupName ?? null,
          localUri: localEntry?.uri ?? null,
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

      diskLibrary.addDisks(disks, runtimeFiles);
      toast({ title: 'Items added', description: `${disks.length} disk(s) added to library.` });
      return true;
    } catch (error) {
      toast({
        title: 'Add items failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
      return false;
    }
  }, [diskLibrary, localSourcesById]);

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
    (disks: DiskEntry[], options?: { showSelection?: boolean; showMenu?: boolean; disableActions?: boolean; onMount?: (disk: DiskEntry) => void }) =>
      disks.map((disk) => {
        const matches = matchesFilter(disk);
        const isDimmed = filterText.length > 0 && !matches;
        return {
          id: disk.id,
          title: disk.name,
          subtitle: disk.path,
          subtitleTestId: 'disk-path',
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
        } as ActionListItem;
      }),
    [buildDiskMenuItems, filterText.length, handleDiskSelect, matchesFilter, selectedDiskIds],
  );

  const driveRows = DRIVE_KEYS.map((key) => {
    const info = drivesData?.drives?.find((entry) => entry[key])?.[key];
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
          {driveRows.map(({ key, info, mounted, mountedDisk, canRotate, mountedLabel }) => (
            <div key={key} className="config-card space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm">{buildDriveLabel(key)}</span>
                  <span className="text-xs text-muted-foreground">#{info?.bus_id ?? '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      info?.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {info?.enabled ? 'ON' : 'OFF'}
                  </span>
                  <DiskIndicator mounted={mounted} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Mounted disk</p>
                  <p className="text-sm font-medium truncate">
                    {mountedLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
        onChange={(event) => handleLocalSourceInput(event.target.files)}
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
        autoConfirmLocalSource
      />

      <Dialog open={Boolean(groupDialogDisk)} onOpenChange={(open) => !open && setGroupDialogDisk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set group</DialogTitle>
            <DialogDescription>Assign a group label for disk rotation.</DialogDescription>
          </DialogHeader>
          <Input value={groupName} onChange={(event) => setGroupName(event.target.value)} />
          <DialogFooter>
            <Button
              variant="default"
              onClick={() => {
                if (!groupDialogDisk) return;
                diskLibrary.updateDiskGroup(groupDialogDisk.id, groupName || null);
                setGroupDialogDisk(null);
              }}
            >
              Save
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
