/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";

const STORAGE_KEY = "c64u_volume_session_writes:v1";

type VolumeWrites = Record<string, string | number>;
type WritesRecord = { deviceId: string; writes: VolumeWrites };

const store = (record: WritesRecord | null) => {
  try {
    if (record) localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    else localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    addErrorLog("Could not save the mixer levels this playback wrote", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

/** Opens the record of mixer levels one playback volume session writes to a device; its restore reads it. */
export const startVolumeSessionWrites = (deviceId: string | null | undefined) =>
  store(deviceId ? { deviceId, writes: {} } : null);

export const endVolumeSessionWrites = () => store(null);

/** Called before each write, so a write whose reply is lost still counts; a write that never landed fails the
 *  restore's comparison with the live value instead. A write to another device than the session's is not noted. */
export const noteVolumeSessionWrites = (updates: VolumeWrites, deviceId?: string) => {
  const record = readRecord();
  if (record && (deviceId === undefined || record.deviceId === deviceId))
    store({ deviceId: record.deviceId, writes: { ...record.writes, ...updates } });
};

const readRecord = (): WritesRecord | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WritesRecord> | null;
    const { deviceId, writes } = parsed ?? {};
    return typeof deviceId === "string" && writes && typeof writes === "object" && !Array.isArray(writes)
      ? { deviceId, writes }
      : null;
  } catch (error) {
    addErrorLog("Could not read the mixer levels this playback wrote", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return null;
  }
};

/** Null when no record exists for this device, as for a session that a build without this record started. */
export const readVolumeSessionWrites = (deviceId: string | null | undefined): VolumeWrites | null => {
  const record = readRecord();
  return deviceId && record?.deviceId === deviceId ? record.writes : null;
};
