/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { buildLocalStorageKey } from "@/generated/variant";
import { addErrorLog } from "@/lib/logging";
import type { ReuSnapshotStorageEntry } from "./reuSnapshotTypes";

const STORE_KEY = buildLocalStorageKey("reu_snapshots:v1");
const UPDATE_EVENT = "c64u-reu-snapshots-updated";

type StoreData = {
  version: 1;
  snapshots: ReuSnapshotStorageEntry[];
};

const isValidEntry = (value: unknown): value is ReuSnapshotStorageEntry => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.filename === "string" &&
    typeof candidate.createdAt === "string" &&
    candidate.snapshotType === "reu" &&
    typeof candidate.sizeBytes === "number" &&
    typeof candidate.remoteFileName === "string" &&
    typeof candidate.storage === "object" &&
    candidate.storage !== null &&
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
    const snapshots = (((parsed as Record<string, unknown>).snapshots as unknown[]) ?? []).filter(isValidEntry);
    return { version: 1, snapshots };
  } catch (error) {
    addErrorLog("Failed to parse REU snapshot store", { error: (error as Error).message });
    return { version: 1, snapshots: [] };
  }
};

const writeStore = (data: StoreData) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
};

const dispatchUpdate = (snapshots: ReuSnapshotStorageEntry[]) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: snapshots }));
};

export const loadReuSnapshotStore = (): ReuSnapshotStorageEntry[] => {
  const data = readStore();
  return [...data.snapshots].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const saveReuSnapshotToStore = (entry: ReuSnapshotStorageEntry) => {
  const data = readStore();
  data.snapshots = [entry, ...data.snapshots.filter((snapshot) => snapshot.id !== entry.id)];
  writeStore(data);
  dispatchUpdate(loadReuSnapshotStore());
};

export const updateReuSnapshotLabel = (id: string, label: string) => {
  const data = readStore();
  const entry = data.snapshots.find((snapshot) => snapshot.id === id);
  if (!entry) return;
  entry.metadata = { ...entry.metadata, label: label.trim() || undefined };
  writeStore(data);
  dispatchUpdate(loadReuSnapshotStore());
};

export const deleteReuSnapshotFromStore = (id: string) => {
  const data = readStore();
  data.snapshots = data.snapshots.filter((snapshot) => snapshot.id !== id);
  writeStore(data);
  dispatchUpdate(loadReuSnapshotStore());
};

export const clearReuSnapshotStore = () => {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORE_KEY);
  }
  dispatchUpdate([]);
};

export const useReuSnapshotStore = () => {
  const [snapshots, setSnapshots] = useState<ReuSnapshotStorageEntry[]>(() => loadReuSnapshotStore());

  useEffect(() => {
    const handler = (event: Event) => {
      setSnapshots((event as CustomEvent<ReuSnapshotStorageEntry[]>).detail ?? []);
    };
    window.addEventListener(UPDATE_EVENT, handler as EventListener);
    return () => window.removeEventListener(UPDATE_EVENT, handler as EventListener);
  }, []);

  return { snapshots };
};
