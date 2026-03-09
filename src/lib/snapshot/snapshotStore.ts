/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { SnapshotStorageEntry, SnapshotType } from "./snapshotTypes";
import { MAX_SNAPSHOTS } from "./snapshotTypes";

const STORE_KEY = "c64u_snapshots:v1";
const UPDATE_EVENT = "c64u-snapshots-updated";

type StoreData = {
  version: 1;
  snapshots: SnapshotStorageEntry[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const base64ToUint8 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

const uint8ToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const isValidEntry = (value: unknown): value is SnapshotStorageEntry => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.filename === "string" &&
    typeof candidate.bytesBase64 === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.snapshotType === "string" &&
    typeof candidate.metadata === "object" &&
    candidate.metadata !== null
  );
};

const readStore = (): StoreData => {
  if (typeof localStorage === "undefined") return { version: 1, snapshots: [] };
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return { version: 1, snapshots: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).version !== 1) {
      return { version: 1, snapshots: [] };
    }
    const rawSnapshots = ((parsed as Record<string, unknown>).snapshots as unknown[]) ?? [];
    const snapshots = rawSnapshots.filter(isValidEntry);
    return { version: 1, snapshots };
  } catch (error) {
    addErrorLog("Failed to parse snapshot store", { error: (error as Error).message });
    return { version: 1, snapshots: [] };
  }
};

const writeStore = (data: StoreData) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (error) {
    addErrorLog("Failed to write snapshot store", { error: (error as Error).message });
    throw new Error(`Failed to save snapshot: ${(error as Error).message}`);
  }
};

const dispatchUpdate = (snapshots: SnapshotStorageEntry[]) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: snapshots }));
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns all stored snapshots, newest first. */
export const loadSnapshotStore = (): SnapshotStorageEntry[] => {
  const data = readStore();
  return [...data.snapshots].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

/** Converts a stored entry back to bytes for restore or export. */
export const snapshotEntryToBytes = (entry: SnapshotStorageEntry): Uint8Array => base64ToUint8(entry.bytesBase64);

/** Saves a new snapshot to the store. Drops oldest if MAX_SNAPSHOTS reached. */
export const saveSnapshotToStore = (entry: Omit<SnapshotStorageEntry, "bytesBase64"> & { bytes: Uint8Array }) => {
  const { bytes, ...rest } = entry;
  const storageEntry: SnapshotStorageEntry = {
    ...rest,
    bytesBase64: uint8ToBase64(bytes),
  };
  const data = readStore();
  data.snapshots.unshift(storageEntry);
  if (data.snapshots.length > MAX_SNAPSHOTS) {
    data.snapshots.splice(MAX_SNAPSHOTS);
  }
  writeStore(data);
  dispatchUpdate(loadSnapshotStore());
};

/** Removes a snapshot by ID. */
export const deleteSnapshotFromStore = (id: string) => {
  const data = readStore();
  data.snapshots = data.snapshots.filter((s) => s.id !== id);
  writeStore(data);
  dispatchUpdate(loadSnapshotStore());
};

/** Updates the label of an existing snapshot. */
export const updateSnapshotLabel = (id: string, label: string) => {
  const data = readStore();
  const entry = data.snapshots.find((s) => s.id === id);
  if (!entry) return;
  entry.metadata = { ...entry.metadata, label: label.trim() || undefined };
  writeStore(data);
  dispatchUpdate(loadSnapshotStore());
};

/** Clears all snapshots (used in tests). */
export const clearSnapshotStore = () => {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORE_KEY);
  }
  dispatchUpdate([]);
};

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

/**
 * Reactive hook that returns the current snapshot list (newest first).
 * Updates whenever a snapshot is saved, deleted, or renamed.
 */
export const useSnapshotStore = (): {
  snapshots: SnapshotStorageEntry[];
  snapshotsByType: (type: SnapshotType | "all") => SnapshotStorageEntry[];
} => {
  const [snapshots, setSnapshots] = useState<SnapshotStorageEntry[]>(() => loadSnapshotStore());

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SnapshotStorageEntry[]>).detail;
      setSnapshots(detail);
    };
    window.addEventListener(UPDATE_EVENT, handler as EventListener);
    return () => window.removeEventListener(UPDATE_EVENT, handler as EventListener);
  }, []);

  const snapshotsByType = (type: SnapshotType | "all") => {
    if (type === "all") return snapshots;
    return snapshots.filter((s) => s.snapshotType === type);
  };

  return { snapshots, snapshotsByType };
};
