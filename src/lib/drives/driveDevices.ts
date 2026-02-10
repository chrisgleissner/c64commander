/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DriveInfo, DrivesResponse } from '@/lib/c64api';

export type DriveDeviceClass =
  | 'PHYSICAL_DRIVE_A'
  | 'PHYSICAL_DRIVE_B'
  | 'SOFT_IEC_DRIVE'
  | 'PRINTER';

export type DriveDeviceLabel = 'Drive A' | 'Drive B' | 'Soft IEC Drive' | 'Printer';

export type KnownDriveDevice = {
  class: DriveDeviceClass;
  label: DriveDeviceLabel;
  apiKey: string;
  endpointKey: string;
  order: number;
  enabled: boolean;
  busId: number | null;
  type: string | null;
  rom: string | null;
  imageFile: string | null;
  imagePath: string | null;
  lastError: string | null;
  partitions: Array<{ id: number; path: string }>;
  raw: DriveInfo;
};

export type UnknownDriveDevice = {
  apiKey: string;
  raw: DriveInfo;
};

export type NormalizedDriveDevices = {
  devices: KnownDriveDevice[];
  unknownDevices: UnknownDriveDevice[];
};

const DEVICE_CLASS_ORDER: Record<DriveDeviceClass, number> = {
  PHYSICAL_DRIVE_A: 0,
  PHYSICAL_DRIVE_B: 1,
  SOFT_IEC_DRIVE: 2,
  PRINTER: 3,
};

const DEVICE_CLASS_LABEL: Record<DriveDeviceClass, DriveDeviceLabel> = {
  PHYSICAL_DRIVE_A: 'Drive A',
  PHYSICAL_DRIVE_B: 'Drive B',
  SOFT_IEC_DRIVE: 'Soft IEC Drive',
  PRINTER: 'Printer',
};

const normalizeDeviceKey = (value: string) => value.trim().toLowerCase();

const resolveKnownClass = (key: string): DriveDeviceClass | null => {
  const normalized = normalizeDeviceKey(key);
  if (normalized === 'a') return 'PHYSICAL_DRIVE_A';
  if (normalized === 'b') return 'PHYSICAL_DRIVE_B';
  if (normalized === 'iec drive' || normalized === 'softiec' || normalized === 'soft iec drive') {
    return 'SOFT_IEC_DRIVE';
  }
  if (normalized === 'printer emulation' || normalized === 'printer') {
    return 'PRINTER';
  }
  return null;
};

const resolveEndpointKey = (deviceClass: DriveDeviceClass, apiKey: string) => {
  const trimmed = apiKey.trim();
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }
  if (deviceClass === 'SOFT_IEC_DRIVE') return 'softiec';
  if (deviceClass === 'PRINTER') return 'printer';
  return trimmed;
};

const normalizePartitions = (value: DriveInfo['partitions']) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { id: number; path: string } =>
      entry !== null
      && typeof entry === 'object'
      && typeof entry.id === 'number'
      && typeof entry.path === 'string')
    .map((entry) => ({ id: entry.id, path: entry.path }));
};

const normalizeKnownDevice = (deviceClass: DriveDeviceClass, apiKey: string, raw: DriveInfo): KnownDriveDevice => ({
  class: deviceClass,
  label: DEVICE_CLASS_LABEL[deviceClass],
  apiKey,
  endpointKey: resolveEndpointKey(deviceClass, apiKey),
  order: DEVICE_CLASS_ORDER[deviceClass],
  enabled: Boolean(raw.enabled),
  busId: typeof raw.bus_id === 'number' ? raw.bus_id : null,
  type: typeof raw.type === 'string' && raw.type.trim() ? raw.type : null,
  rom: typeof raw.rom === 'string' && raw.rom.trim() ? raw.rom : null,
  imageFile: typeof raw.image_file === 'string' && raw.image_file.trim() ? raw.image_file : null,
  imagePath: typeof raw.image_path === 'string' && raw.image_path.trim() ? raw.image_path : null,
  lastError: typeof raw.last_error === 'string' && raw.last_error.trim() ? raw.last_error : null,
  partitions: normalizePartitions(raw.partitions),
  raw,
});

export const normalizeDriveDevices = (
  payload?: Pick<DrivesResponse, 'drives'> | null,
): NormalizedDriveDevices => {
  const knownByClass = new Map<DriveDeviceClass, KnownDriveDevice>();
  const unknownDevices: UnknownDriveDevice[] = [];

  const entries = Array.isArray(payload?.drives) ? payload.drives : [];
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    Object.entries(entry).forEach(([apiKey, rawValue]) => {
      if (!rawValue || typeof rawValue !== 'object') {
        return;
      }
      const raw = rawValue as DriveInfo;
      const deviceClass = resolveKnownClass(apiKey);
      if (!deviceClass) {
        unknownDevices.push({ apiKey, raw });
        return;
      }
      if (knownByClass.has(deviceClass)) return;
      knownByClass.set(deviceClass, normalizeKnownDevice(deviceClass, apiKey, raw));
    });
  });

  const devices = Array.from(knownByClass.values()).sort((left, right) => left.order - right.order);

  return {
    devices,
    unknownDevices,
  };
};

export const getKnownDevice = (
  payload: Pick<DrivesResponse, 'drives'> | null | undefined,
  deviceClass: DriveDeviceClass,
): KnownDriveDevice | null => {
  const normalized = normalizeDriveDevices(payload);
  return normalized.devices.find((entry) => entry.class === deviceClass) ?? null;
};

const dedupeStringValues = (values: Array<number | string>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = String(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

export const buildBusIdOptions = (defaults: number[], current: number | null) => {
  const values: Array<number | string> = [...defaults];
  if (current !== null) {
    values.unshift(current);
  }
  return dedupeStringValues(values);
};

export const buildTypeOptions = (defaults: string[], current: string | null) => {
  const values: Array<number | string> = [...defaults];
  if (current && current.trim()) {
    values.unshift(current.trim());
  }
  return dedupeStringValues(values);
};
