import { useMemo, useRef, useState } from 'react';
import { Disc, ArrowLeftRight, ArrowRightLeft, FolderOpen, HardDrive, PlugZap, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { toast } from '@/hooks/use-toast';
import { useC64Connection, useC64Drives } from '@/hooks/useC64Connection';
import { getC64API } from '@/lib/c64api';
import { addErrorLog } from '@/lib/logging';
import { DiskTree } from '@/components/disks/DiskTree';
import { mountDiskToDrive } from '@/lib/disks/diskMount';
import {
  importLocalDiskFiles,
  importLocalDiskFolder,
  importLocalDiskFolderFromInput,
  prepareDiskDirectoryInput,
} from '@/lib/disks/localDiskPicker';
import { importFtpFile, importFtpFolder, listFtpEntries } from '@/lib/disks/ftpDiskImport';
import { normalizeDiskPath, type DiskEntry } from '@/lib/disks/diskTypes';
import { useDiskLibrary } from '@/hooks/useDiskLibrary';

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
  const [localDialogOpen, setLocalDialogOpen] = useState(false);
  const [ftpDrawerOpen, setFtpDrawerOpen] = useState(false);
  const [ftpPath, setFtpPath] = useState('/');
  const [ftpEntries, setFtpEntries] = useState<Array<{ name: string; path: string; type: 'file' | 'dir' }>>([]);
  const [ftpLoading, setFtpLoading] = useState(false);
  const [groupDialogDisk, setGroupDialogDisk] = useState<DiskEntry | null>(null);
  const [groupName, setGroupName] = useState('');
  const [renameDialogDisk, setRenameDialogDisk] = useState<DiskEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteDialogDisk, setDeleteDialogDisk] = useState<DiskEntry | null>(null);

  const localInputRef = useRef<HTMLInputElement | null>(null);
  const localFolderInputRef = useRef<HTMLInputElement | null>(null);

  const api = getC64API();

  const showNoDiskWarning = () => {
    toast({
      title: 'No disks found',
      description: 'Found no disk file.',
      variant: 'destructive',
    });
  };

  const handleFolderInputRef = (input: HTMLInputElement | null) => {
    localFolderInputRef.current = input;
    prepareDiskDirectoryInput(input);
  };
  const ftpVisibleEntries = useMemo(
    () =>
      ftpEntries.filter(
        (entry) => entry.type === 'dir' || entry.name.toLowerCase().match(/\.(d64|g64|d71|g71|d81)$/),
      ),
    [ftpEntries],
  );

  const refreshFtp = async (path: string) => {
    setFtpLoading(true);
    setFtpPath(path);
    try {
      const host = localStorage.getItem('c64u_device_host') || 'c64u';
      const password = localStorage.getItem('c64u_password') || '';
      const entries = await listFtpEntries({ host, password, path });
      setFtpEntries(entries);
    } catch (error) {
      toast({
        title: 'FTP browse failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setFtpLoading(false);
    }
  };

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
    if (!driveInfo?.image_file) return mountedByDrive[drive] || null;
    const fullPath = buildDrivePath(driveInfo.image_path, driveInfo.image_file);
    if (!fullPath) return null;
    const disk = diskLibrary.disks.find((entry) => entry.location === 'ultimate' && entry.path === fullPath);
    if (disk?.id) return disk.id;
    return mountedByDrive[drive] || null;
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

  const handleDeleteDisk = async (disk: DiskEntry) => {
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
        toast({
          title: 'Disk removed',
          description: 'Disk ejected from mounted drives.',
        });
      } catch (error) {
        addErrorLog('Disk eject failed', { error: (error as Error).message });
      }
    }
    diskLibrary.removeDisk(disk.id);
  };

  const handleLocalFiles = (files: FileList | null) => {
    const selection = importLocalDiskFiles(files);
    if (!selection.disks.length) {
      showNoDiskWarning();
      return;
    }
    diskLibrary.addDisks(selection.disks, selection.runtimeFiles);
    toast({ title: 'Disks imported', description: `${selection.disks.length} disk(s) added.` });
    setLocalDialogOpen(false);
  };

  const handleLocalFolderInput = (files: FileList | null) => {
    const selection = importLocalDiskFolderFromInput(files);
    if (!selection.disks.length) {
      showNoDiskWarning();
      return;
    }
    diskLibrary.addDisks(selection.disks, selection.runtimeFiles);
    toast({ title: 'Folder imported', description: `${selection.disks.length} disk(s) added.` });
    setLocalDialogOpen(false);
  };

  const handleLocalFolder = async () => {
    try {
      const selection = await importLocalDiskFolder();
      if (!selection || !selection.disks.length) {
        showNoDiskWarning();
        return;
      }
      diskLibrary.addDisks(selection.disks, selection.runtimeFiles);
      toast({ title: 'Folder imported', description: `${selection.disks.length} disk(s) added.` });
    } catch (error) {
      toast({
        title: 'Folder import failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleFtpImportFile = (path: string) => {
    try {
      const disk = importFtpFile(path);
      diskLibrary.addDisks([disk]);
      toast({ title: 'Disk added', description: disk.name });
    } catch (error) {
      if ((error as Error).message.includes('Found no disk file')) {
        showNoDiskWarning();
        return;
      }
      toast({
        title: 'Import failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleFtpImportFolder = async (path: string) => {
    try {
      const host = localStorage.getItem('c64u_device_host') || 'c64u';
      const password = localStorage.getItem('c64u_password') || '';
      const disks = await importFtpFolder({ host, password, path });
      if (!disks.length) {
        showNoDiskWarning();
        return;
      }
      diskLibrary.addDisks(disks);
      toast({ title: 'Folder imported', description: `${disks.length} disk(s) added.` });
    } catch (error) {
      toast({
        title: 'FTP import failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const driveRows = DRIVE_KEYS.map((key) => {
    const info = drivesData?.drives?.find((entry) => entry[key])?.[key];
    const mountedDiskId = resolveMountedDiskId(key);
    const mounted = Boolean(info?.image_file || mountedDiskId);
    const mountedDisk = mountedDiskId ? disksById[mountedDiskId] : null;
    const groupSize = mountedDisk?.group
      ? diskLibrary.disks.filter((disk) => disk.group === mountedDisk.group).length
      : 0;
    const canRotate = Boolean(mountedDisk?.group && groupSize > 1);

    return {
      key,
      info,
      mounted,
      mountedDisk,
      canRotate,
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
          {driveRows.map(({ key, info, mounted, mountedDisk, canRotate }) => (
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
                    {info?.image_file || mountedDisk?.name || '—'}
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

        <div className="bg-card border border-border rounded-xl p-4" data-testid="disk-library-tree">
          <DiskTree
            tree={diskLibrary.tree}
            disksById={disksByIdMap}
            filter={diskLibrary.filter}
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
          <Button variant="outline" onClick={() => setLocalDialogOpen(true)}>
            + Add from local device
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setFtpDrawerOpen(true);
              void refreshFtp('/');
            }}
            disabled={!status.isConnected}
          >
            + Add from C64 Ultimate
          </Button>
        </div>
      </section>

      <Drawer open={Boolean(activeDrive)} onOpenChange={(open) => !open && setActiveDrive(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Mount disk to {activeDrive ? buildDriveLabel(activeDrive) : ''}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            <DiskTree
              tree={diskLibrary.tree}
              disksById={disksByIdMap}
              filter={diskLibrary.filter}
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
            <div className="pt-3">
              <Button variant="ghost" onClick={() => setActiveDrive(null)}>
                Close
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={Boolean(activeDisk)} onOpenChange={(open) => !open && setActiveDisk(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Mount {activeDisk?.name}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4 space-y-2">
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
            <Button variant="ghost" onClick={() => setActiveDisk(null)}>
              Close
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={localDialogOpen} onOpenChange={setLocalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add local disks</DialogTitle>
            <DialogDescription>Select disk files or an entire folder.</DialogDescription>
          </DialogHeader>
          <input
            ref={localInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => handleLocalFiles(event.target.files)}
          />
          <input
            ref={handleFolderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => handleLocalFolderInput(event.target.files)}
          />
          <div className="space-y-2">
            <Button
              variant="outline"
              data-skip-click
              onClick={() => {
                localInputRef.current?.click();
                setLocalDialogOpen(false);
              }}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              Pick files
            </Button>
            <Button
              variant="outline"
              data-skip-click
              onClick={() => {
                setLocalDialogOpen(false);
                if (Capacitor.getPlatform() === 'android') {
                  void handleLocalFolder();
                  return;
                }
                if (localFolderInputRef.current) {
                  localFolderInputRef.current.click();
                  return;
                }
                void handleLocalFolder();
              }}
            >
              <PlugZap className="h-4 w-4 mr-2" />
              Pick folder
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLocalDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Drawer open={ftpDrawerOpen} onOpenChange={setFtpDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Browse C64 Ultimate</DrawerTitle>
          </DrawerHeader>
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Path: {ftpPath}</span>
              <div className="flex items-center gap-2">
                {ftpPath !== '/' && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void handleFtpImportFolder(ftpPath)}
                    disabled={ftpLoading}
                  >
                    Import
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void refreshFtp(ftpPath)} disabled={ftpLoading}>
                  Refresh
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {ftpVisibleEntries.map((entry) => (
                <div key={entry.path} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                    <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.path}</p>
                  </div>
                  {entry.type === 'dir' ? (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => void refreshFtp(entry.path)}>
                        Open
                      </Button>
                      <Button variant="default" size="sm" onClick={() => void handleFtpImportFolder(entry.path)}>
                        Import
                      </Button>
                    </div>
                  ) : (
                    <Button variant="default" size="sm" onClick={() => handleFtpImportFile(entry.path)}>
                      Add
                    </Button>
                  )}
                </div>
              ))}
              {ftpVisibleEntries.length === 0 && (
                <p className="text-xs text-muted-foreground">No disk images in this folder.</p>
              )}
            </div>
            <div className="pt-2">
              <Button variant="ghost" onClick={() => setFtpDrawerOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

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
    </div>
  );
};
