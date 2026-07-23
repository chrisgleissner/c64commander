/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability A — Disk Explorer React binding.
 *
 * Loads a disk image's bytes (the same blob the app already fetches to mount, so
 * listing/extraction cost zero extra device round-trips), lists its directory, and
 * runs Run / Load / Mount & Load on any single entry via diskLaunch.ts.
 */

import { useCallback, useRef, useState } from "react";
import type { C64API } from "@/lib/c64api";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { addErrorLog } from "@/lib/logging";
import { getFileExtension } from "@/lib/playback/fileTypes";
import { listDirectory, type DiskDirectoryEntry, type DiskImageType } from "@/lib/disks/diskImage";
import { runDiskEntry, mountAndLoadEntry } from "@/lib/playback/diskLaunch";
import { resolveLocalDiskBlob } from "@/lib/disks/diskMount";
import { getDiskName, type DiskEntry } from "@/lib/disks/diskTypes";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import type { DiskEntryAction } from "@/components/disks/DiskContentsDialog";

const EXPLORABLE_TYPES = new Set<DiskImageType>(["d64", "d71", "d81"]);

export const diskTypeForPath = (path: string): DiskImageType | null => {
  const ext = getFileExtension(path);
  return EXPLORABLE_TYPES.has(ext as DiskImageType) ? (ext as DiskImageType) : null;
};

/** Load a disk image's raw bytes: local via resolveLocalDiskBlob, ultimate via FTP. */
export const loadDiskImageBytes = async (disk: DiskEntry, runtimeFile?: File): Promise<Uint8Array> => {
  if (disk.location === "ultimate") {
    const { deviceHost, password = "" } = getC64APIConfigSnapshot();
    const path = disk.path.startsWith("/") ? disk.path : `/${disk.path}`;
    const response = await readFtpFile({
      host: normalizeFtpHost(deviceHost),
      port: getStoredFtpPort(),
      password,
      path,
    });
    return base64ToUint8(response.data);
  }
  const blob = await resolveLocalDiskBlob(disk, runtimeFile);
  return new Uint8Array(await blob.arrayBuffer());
};

export interface DiskExplorerToast {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

export interface UseDiskExplorerOptions {
  api: C64API;
  /** Loads the disk's bytes (defaults to loadDiskImageBytes). */
  loadImage?: (disk: DiskEntry, runtimeFile?: File) => Promise<Uint8Array>;
  /** Mounts the whole image for Mount & Load (reuses the app's mount flow). */
  mount?: (disk: DiskEntry) => Promise<void>;
  drive?: "a" | "b";
  onToast?: (toast: DiskExplorerToast) => void;
}

export interface DiskExplorerState {
  open: boolean;
  disk: DiskEntry | null;
  diskName: string;
  diskType: DiskImageType | null;
  image: Uint8Array | null;
  entries: DiskDirectoryEntry[] | null;
  loading: boolean;
  error: string | null;
  busyIndex: number | null;
}

const INITIAL: DiskExplorerState = {
  open: false,
  disk: null,
  diskName: "",
  diskType: null,
  image: null,
  entries: null,
  loading: false,
  error: null,
  busyIndex: null,
};

export const useDiskExplorer = ({
  api,
  loadImage = loadDiskImageBytes,
  mount,
  drive = "a",
  onToast,
}: UseDiskExplorerOptions) => {
  const [state, setState] = useState<DiskExplorerState>(INITIAL);
  const loadedRef = useRef<{ disk: DiskEntry; image: Uint8Array; diskType: DiskImageType } | null>(null);

  const close = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);

  const openDisk = useCallback(
    async (disk: DiskEntry, runtimeFile?: File) => {
      const diskType = diskTypeForPath(disk.path);
      const diskName = getDiskName(disk.path);
      if (!diskType) {
        onToast?.({
          title: "Can't open this image",
          description: "Disk Explorer supports .d64, .d71 and .d81 images.",
          variant: "destructive",
        });
        return;
      }
      loadedRef.current = null;
      setState({ ...INITIAL, open: true, disk, diskName, diskType, loading: true });
      try {
        const image = await loadImage(disk, runtimeFile);
        const entries = listDirectory(image, diskType);
        loadedRef.current = { disk, image, diskType };
        setState((prev) => ({ ...prev, image, entries, loading: false }));
      } catch (error) {
        const message = (error as Error)?.message ?? "Could not read the disk image.";
        addErrorLog("Disk Explorer failed to open image", { path: disk.path, error: message });
        setState((prev) => ({ ...prev, loading: false, error: `Unreadable directory: ${message}` }));
      }
    },
    [loadImage, onToast],
  );

  const runAction = useCallback(
    async (action: DiskEntryAction, entry: DiskDirectoryEntry) => {
      const loaded = loadedRef.current;
      if (!loaded) return;
      setState((prev) => ({ ...prev, busyIndex: entry.index }));
      try {
        if (action === "mountAndLoad") {
          if (!mount) throw new Error("Mount is not available here.");
          await mountAndLoadEntry(api, drive, entry, { mount: () => mount(loaded.disk) });
        } else {
          await runDiskEntry(api, loaded.image, loaded.diskType, entry, action);
        }
        onToast?.({ title: `${action === "load" ? "Loaded" : "Launched"} ${entry.name || "program"}` });
        setState((prev) => ({ ...prev, busyIndex: null, open: false }));
      } catch (error) {
        const message = (error as Error)?.message ?? "Launch failed.";
        onToast?.({ title: "Launch failed", description: message, variant: "destructive" });
        setState((prev) => ({ ...prev, busyIndex: null }));
      }
    },
    [api, drive, mount, onToast],
  );

  return {
    ...state,
    openDisk,
    runAction,
    close,
    setOpen: (open: boolean) => setState((prev) => ({ ...prev, open })),
  };
};
