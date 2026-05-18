/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DeviceInfo } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import type { TelnetCapabilitySnapshot } from "@/lib/telnet/telnetCapabilityDiscovery";

const LOG_TAG = "TelnetCapabilityCache";
const STORAGE_PREFIX = "c64u:telnetCapability:";

type PersistedTelnetCapabilitySnapshot = {
  snapshot: TelnetCapabilitySnapshot;
  uniqueId: string | null;
  firmwareVersion: string | null;
};

const capabilityCache = new Map<string, TelnetCapabilitySnapshot>();

const normalizeValue = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const getUniqueId = (deviceInfo: DeviceInfo | null | undefined) => normalizeValue(deviceInfo?.unique_id);
const getFirmwareVersion = (deviceInfo: DeviceInfo | null | undefined) => normalizeValue(deviceInfo?.firmware_version);

const buildStorageKey = (cacheKey: string) => `${STORAGE_PREFIX}${cacheKey}`;

const parsePersistedSnapshot = (storageKey: string, raw: string): PersistedTelnetCapabilitySnapshot | null => {
  try {
    const parsed = JSON.parse(raw) as PersistedTelnetCapabilitySnapshot | null;
    if (!parsed?.snapshot || typeof parsed.snapshot.cacheKey !== "string") {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch (error) {
    addLog("warn", `${LOG_TAG}: failed to parse persisted capability snapshot`, {
      storageKey,
      error: (error as Error).message,
    });
    localStorage.removeItem(storageKey);
    return null;
  }
};

const pruneFirmwareNamespace = (deviceInfo: DeviceInfo | null | undefined) => {
  if (typeof localStorage === "undefined") return;

  const uniqueId = getUniqueId(deviceInfo);
  const firmwareVersion = getFirmwareVersion(deviceInfo);
  if (!uniqueId || !firmwareVersion) return;

  const storageKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) {
      storageKeys.push(key);
    }
  }

  for (const storageKey of storageKeys) {
    const raw = localStorage.getItem(storageKey);
    if (!raw) continue;
    const persisted = parsePersistedSnapshot(storageKey, raw);
    if (!persisted) continue;
    if (persisted.uniqueId !== uniqueId) continue;
    if (!persisted.firmwareVersion || persisted.firmwareVersion === firmwareVersion) continue;
    capabilityCache.delete(persisted.snapshot.cacheKey);
    localStorage.removeItem(storageKey);
  }
};

const loadPersistedSnapshot = (cacheKey: string) => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(buildStorageKey(cacheKey));
  if (!raw) return null;
  const persisted = parsePersistedSnapshot(buildStorageKey(cacheKey), raw);
  return persisted?.snapshot ?? null;
};

const persistSnapshot = (snapshot: TelnetCapabilitySnapshot, deviceInfo: DeviceInfo | null | undefined) => {
  if (typeof localStorage === "undefined") return;
  const persisted: PersistedTelnetCapabilitySnapshot = {
    snapshot,
    uniqueId: getUniqueId(deviceInfo),
    firmwareVersion: getFirmwareVersion(deviceInfo),
  };
  localStorage.setItem(buildStorageKey(snapshot.cacheKey), JSON.stringify(persisted));
};

export const getCachedTelnetCapabilities = (
  cacheKey: string,
  deviceInfo?: DeviceInfo | null,
): TelnetCapabilitySnapshot | null => {
  pruneFirmwareNamespace(deviceInfo);
  const cached = capabilityCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const persisted = loadPersistedSnapshot(cacheKey);
  if (!persisted) {
    return null;
  }
  capabilityCache.set(cacheKey, persisted);
  return persisted;
};

export const rememberTelnetCapabilities = (
  snapshot: TelnetCapabilitySnapshot,
  deviceInfo?: DeviceInfo | null,
): TelnetCapabilitySnapshot => {
  pruneFirmwareNamespace(deviceInfo);
  capabilityCache.set(snapshot.cacheKey, snapshot);
  persistSnapshot(snapshot, deviceInfo);
  return snapshot;
};

export const clearTelnetCapabilityCache = () => {
  capabilityCache.clear();
  if (typeof localStorage === "undefined") return;

  const storageKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) {
      storageKeys.push(key);
    }
  }
  for (const storageKey of storageKeys) {
    localStorage.removeItem(storageKey);
  }
};
