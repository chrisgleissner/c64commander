/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { valuesEqual } from "@/lib/config/sidVolumeControl";
import { addErrorLog } from "@/lib/logging";

const STORAGE_KEY = "c64u_volume_session_writes:v1";

type VolumeWrites = Record<string, string | number>;
type WritesRecord = { deviceId: string; writes: VolumeWrites; before: VolumeWrites };

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
  store(deviceId ? { deviceId, writes: {}, before: {} } : null);

export const endVolumeSessionWrites = () => store(null);

/** Called before each write, so a write whose reply is lost still counts; a write that never landed fails the
 *  restore's comparison with the live value instead. A write to another device than the session's is not noted.
 *  `before` keeps the level each item held in the record before its latest change, which tells a pause mute's
 *  restore whether the level it puts back was this phone's own. */
export const noteVolumeSessionWrites = (updates: VolumeWrites, deviceId?: string) => {
  const record = readRecord();
  if (!record || (deviceId !== undefined && record.deviceId !== deviceId)) return;
  const before = { ...record.before };
  for (const [name, value] of Object.entries(updates)) {
    if (name in record.writes && !valuesEqual(record.writes[name], value)) before[name] = record.writes[name];
  }
  store({ deviceId: record.deviceId, writes: { ...record.writes, ...updates }, before });
};

/** Called before the write that puts back the levels a pause mute replaced. A level is recorded as this phone's own
 *  only if the record held it before the mute; any other was set elsewhere, so it leaves the record and Stop keeps it. */
export const noteRestoredVolumeSessionWrites = (restored: VolumeWrites, deviceId: string) => {
  const record = readRecord();
  if (!record || record.deviceId !== deviceId) return;
  const writes = { ...record.writes };
  const before = { ...record.before };
  for (const [name, value] of Object.entries(restored)) {
    if (valuesEqual(before[name], value)) writes[name] = value;
    else delete writes[name];
    delete before[name];
  }
  store({ deviceId, writes, before });
};

const isPlainObject = (value: unknown): value is VolumeWrites =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (): WritesRecord | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WritesRecord> | null;
    const { deviceId, writes, before } = parsed ?? {};
    return typeof deviceId === "string" && isPlainObject(writes)
      ? { deviceId, writes, before: isPlainObject(before) ? before : {} }
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
