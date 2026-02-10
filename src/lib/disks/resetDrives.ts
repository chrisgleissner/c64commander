/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DrivesResponse } from '@/lib/c64api';
import { normalizeDriveDevices, type DriveDeviceClass, type KnownDriveDevice } from '@/lib/drives/driveDevices';

export type DriveKey = 'a' | 'b';

export type ResetApi = {
  resetDrive: (drive: string) => Promise<unknown>;
};

const DISK_RESET_CLASSES: DriveDeviceClass[] = [
  'PHYSICAL_DRIVE_A',
  'PHYSICAL_DRIVE_B',
  'SOFT_IEC_DRIVE',
];

const buildFailureMessage = (failures: Array<{ label: string; error: string }>) =>
  failures
    .map(({ label, error }) => `${label}: ${error}`)
    .join('; ');

const toLegacyDriveKey = (device: KnownDriveDevice): DriveKey | null => {
  if (device.class === 'PHYSICAL_DRIVE_A') return 'a';
  if (device.class === 'PHYSICAL_DRIVE_B') return 'b';
  return null;
};

export const listConnectedDrives = (payload?: Pick<DrivesResponse, 'drives'> | null): DriveKey[] => {
  const normalized = normalizeDriveDevices(payload);
  return normalized.devices
    .map((device) => toLegacyDriveKey(device))
    .filter((value): value is DriveKey => value !== null);
};

const listDiskResetTargets = (payload?: Pick<DrivesResponse, 'drives'> | null) => {
  const normalized = normalizeDriveDevices(payload);
  return DISK_RESET_CLASSES
    .map((deviceClass) => normalized.devices.find((entry) => entry.class === deviceClass) ?? null)
    .filter((entry): entry is KnownDriveDevice => entry !== null);
};

export const getPrinterResetTarget = (payload?: Pick<DrivesResponse, 'drives'> | null) => {
  const normalized = normalizeDriveDevices(payload);
  return normalized.devices.find((entry) => entry.class === 'PRINTER') ?? null;
};

const resetTargets = async (
  api: ResetApi,
  targets: KnownDriveDevice[],
  unsupportedMessage: string,
) => {
  if (!targets.length) {
    throw new Error(unsupportedMessage);
  }

  const failures: Array<{ label: string; error: string }> = [];

  for (const target of targets) {
    if (!target.endpointKey) {
      // Unsupported targets must remain read-only; we do not simulate reset operations.
      throw new Error(`Reset is not supported for ${target.label}.`);
    }
    try {
      await api.resetDrive(target.endpointKey);
    } catch (error) {
      failures.push({
        label: target.label,
        error: (error as Error).message,
      });
    }
  }

  if (failures.length) {
    throw new Error(`Failed to reset devices: ${buildFailureMessage(failures)}`);
  }

  return targets;
};

export const resetDiskDevices = async (
  api: ResetApi,
  payload?: Pick<DrivesResponse, 'drives'> | null,
) => {
  const targets = listDiskResetTargets(payload);
  const reset = await resetTargets(api, targets, 'No resettable disk devices found.');
  return {
    devices: reset,
    endpointKeys: reset.map((entry) => entry.endpointKey),
  };
};

export const resetPrinterDevice = async (
  api: ResetApi,
  payload?: Pick<DrivesResponse, 'drives'> | null,
) => {
  const printer = getPrinterResetTarget(payload);
  const reset = await resetTargets(api, printer ? [printer] : [], 'No printer device found.');
  return {
    device: reset[0],
    endpointKey: reset[0].endpointKey,
  };
};

// Backward-compatible helper retained for existing disk reset callers.
export const resetConnectedDrives = async (
  api: ResetApi,
  payload?: Pick<DrivesResponse, 'drives'> | null,
) => {
  const result = await resetDiskDevices(api, payload);
  const drives = result.devices
    .map((device) => toLegacyDriveKey(device))
    .filter((value): value is DriveKey => value !== null);
  return { drives };
};
