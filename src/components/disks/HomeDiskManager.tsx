import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Disc, ArrowLeftRight, ArrowRightLeft, HardDrive, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { toast } from '@/hooks/use-toast';
import { useC64Connection, useC64Drives } from '@/hooks/useC64Connection';
import { useLocalSources } from '@/hooks/useLocalSources';
import { getC64API } from '@/lib/c64api';
import { addErrorLog } from '@/lib/logging';
import { DiskTree } from '@/components/disks/DiskTree';
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
        return;
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
    } catch (error) {
      toast({
        title: 'Add items failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [diskLibrary, localSourcesById]);

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

  const disksByIdMap = disksById;

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

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {selectedCount ? `${selectedCount} selected` : 'No disks selected'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSelectAll}
              disabled={!diskLibrary.disks.length}
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </Button>
            {selectedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Remove from library
              </Button>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4" data-testid="disk-library-tree">
          <DiskTree
            tree={diskLibrary.tree}
            disksById={disksByIdMap}
            filter={diskLibrary.filter}
            selectedDiskIds={selectedDiskIds}
            onDiskSelect={handleDiskSelect}
            onDiskMount={(disk) => {
              if (!status.isConnected) {
                toast({ title: 'Offline', description: 'Connect to mount disks.', variant: 'destructive' });
                return;
              }
              setActiveDisk(disk);
            }}
            onDiskDelete={(disk) => setDeleteDialogDisk(disk)}
            onDiskGroup={(disk) => {
              setGroupDialogDisk(disk);
              setGroupName(disk.group || '');
            }}
            onDiskRename={(disk) => {
              setRenameDialogDisk(disk);
              setRenameValue(disk.name || '');
            }}
          />
        </div>

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
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Mount disk to {activeDrive ? buildDriveLabel(activeDrive) : ''}</DialogTitle>
              <Button variant="ghost" size="icon" onClick={() => setActiveDrive(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <DiskTree
            tree={diskLibrary.tree}
            disksById={disksByIdMap}
            filter={diskLibrary.filter}
            showSelection={false}
            onDiskMount={(disk) => {
              if (!activeDrive) return;
              void handleMountDisk(activeDrive, disk).finally(() => setActiveDrive(null));
            }}
            onDiskDelete={(disk) => setDeleteDialogDisk(disk)}
            onDiskGroup={(disk) => {
              setGroupDialogDisk(disk);
              setGroupName(disk.group || '');
            }}
            onDiskRename={(disk) => {
              setRenameDialogDisk(disk);
              setRenameValue(disk.name || '');
            }}
            disableActions={!status.isConnected}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(activeDisk)} onOpenChange={(open) => !open && setActiveDisk(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>Mount {activeDisk?.name}</DialogTitle>
              <Button variant="ghost" size="icon" onClick={() => setActiveDisk(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
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
            <DialogTitle>Delete disk?</DialogTitle>
            <DialogDescription>
              This removes the disk from your library. The original file is not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteDialogDisk) return;
                void handleDeleteDisk(deleteDialogDisk);
                setDeleteDialogDisk(null);
              }}
            >
              Delete
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
                ? `This removes ${selectedCount} disk(s) from your library. Files are not deleted.`
                : 'No disks selected.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={() => void handleBulkDelete()} disabled={!selectedCount}>
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
