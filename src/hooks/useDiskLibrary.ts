import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addErrorLog } from '@/lib/logging';
import { buildDiskId, createDiskEntry, getDiskName, normalizeDiskPath, type DiskEntry } from '@/lib/disks/diskTypes';
import { loadDiskLibrary, saveDiskLibrary } from '@/lib/disks/diskStore';
import { buildDiskTreeState } from '@/lib/disks/diskTree';

export type DiskLibrary = {
  disks: DiskEntry[];
  runtimeFiles: Record<string, File>;
  filter: string;
  setFilter: (value: string) => void;
  tree: ReturnType<typeof buildDiskTreeState>;
  addDisks: (entries: DiskEntry[], runtime?: Record<string, File>) => void;
  removeDisk: (diskId: string) => void;
  updateDiskGroup: (diskId: string, group: string | null) => void;
  updateDiskName: (diskId: string, name: string) => void;
  getDiskById: (diskId: string) => DiskEntry | undefined;
};

export const useDiskLibrary = (uniqueId: string | null): DiskLibrary => {
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const [runtimeFiles, setRuntimeFiles] = useState<Record<string, File>>({});
  const [filter, setFilter] = useState('');
  const lastUniqueIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uniqueId) {
      lastUniqueIdRef.current = null;
      return;
    }
    const state = loadDiskLibrary(uniqueId);
    const normalized = (state.disks || []).map((disk) => ({
      ...disk,
      importedAt: disk.importedAt || new Date().toISOString(),
      importOrder: disk.importOrder ?? null,
    }));
    setDisks((prev) => {
      if (!prev.length) return normalized;
      if (lastUniqueIdRef.current && lastUniqueIdRef.current === uniqueId) return normalized;
      const existingIds = new Set(normalized.map((disk) => disk.id));
      const merged = [...normalized];
      prev.forEach((disk) => {
        if (!existingIds.has(disk.id)) merged.push(disk);
      });
      return merged;
    });
    lastUniqueIdRef.current = uniqueId;
  }, [uniqueId]);

  useEffect(() => {
    if (!uniqueId) return;
    saveDiskLibrary(uniqueId, { disks });
  }, [disks, uniqueId]);

  const addDisks = useCallback((entries: DiskEntry[], runtime: Record<string, File> = {}) => {
    setRuntimeFiles((prev) => ({ ...prev, ...runtime }));
    setDisks((prev) => {
      const next = [...prev];
      const existing = new Set(prev.map((disk) => disk.id));
      entries.forEach((entry) => {
        if (existing.has(entry.id)) return;
        next.push(entry);
      });
      return next;
    });
  }, []);

  const removeDisk = useCallback((diskId: string) => {
    setRuntimeFiles((prev) => {
      if (!(diskId in prev)) return prev;
      const { [diskId]: _, ...rest } = prev;
      return rest;
    });
    setDisks((prev) => prev.filter((disk) => disk.id !== diskId));
  }, []);

  const updateDiskGroup = useCallback((diskId: string, group: string | null) => {
    setDisks((prev) =>
      prev.map((disk) => (disk.id === diskId ? { ...disk, group: group || null } : disk)),
    );
  }, []);

  const updateDiskName = useCallback((diskId: string, name: string) => {
    setDisks((prev) =>
      prev.map((disk) => (disk.id === diskId ? { ...disk, name: name.trim() || disk.name } : disk)),
    );
  }, []);

  const getDiskById = useCallback((diskId: string) => disks.find((disk) => disk.id === diskId), [disks]);

  const tree = useMemo(() => buildDiskTreeState(disks, filter), [disks, filter]);

  return {
    disks,
    runtimeFiles,
    filter,
    setFilter,
    tree,
    addDisks,
    removeDisk,
    updateDiskGroup,
    updateDiskName,
    getDiskById,
  };
};

export const buildDiskEntryFromPath = (location: 'local' | 'ultimate', path: string, group?: string | null) => {
  const normalized = normalizeDiskPath(path);
  return createDiskEntry({
    path: normalized,
    location,
    group: group || null,
  });
};

export const buildDiskEntryFromDrive = (location: 'local' | 'ultimate', path?: string | null) => {
  if (!path) return null;
  try {
    const normalized = normalizeDiskPath(path);
    return buildDiskId(location, normalized);
  } catch (error) {
    addErrorLog('Disk id build failed', { path, error: (error as Error).message });
    return null;
  }
};

export const toDisplayName = (disk: DiskEntry) => disk.name || getDiskName(disk.path);
