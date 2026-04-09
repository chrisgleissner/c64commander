/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFtpFile } from "@/lib/ftp/ftpClient";
import { normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { getPasswordForDevice } from "@/lib/secureStorage";
import { getSavedDeviceById, getSelectedSavedDevice } from "./store";

export type DeviceBoundContentOrigin = {
  sourceKind: "ultimate";
  originDeviceId: string;
  originDeviceLastKnownUniqueId: string | null;
  originPath: string;
  importedAt: string;
};

const normalizeOriginPath = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const base64ToUint8 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const buildSelectedDeviceBoundOrigin = (originPath: string): DeviceBoundContentOrigin | null => {
  const selectedDevice = getSelectedSavedDevice();
  if (!selectedDevice) return null;
  return {
    sourceKind: "ultimate",
    originDeviceId: selectedDevice.id,
    originDeviceLastKnownUniqueId: selectedDevice.lastKnownUniqueId ?? null,
    originPath: normalizeOriginPath(originPath),
    importedAt: new Date().toISOString(),
  };
};

export const isOriginOnSelectedDevice = (origin?: DeviceBoundContentOrigin | null) => {
  if (!origin || origin.sourceKind !== "ultimate") return true;
  const selectedDevice = getSelectedSavedDevice();
  if (!selectedDevice) return false;
  if (origin.originDeviceId === selectedDevice.id) return true;
  if (
    origin.originDeviceLastKnownUniqueId &&
    selectedDevice.lastKnownUniqueId &&
    origin.originDeviceLastKnownUniqueId === selectedDevice.lastKnownUniqueId
  ) {
    return true;
  }
  return false;
};

export const getOriginDeviceUnavailableReason = (origin?: DeviceBoundContentOrigin | null) => {
  if (!origin || origin.sourceKind !== "ultimate") return null;
  const originDevice = getSavedDeviceById(origin.originDeviceId);
  if (!originDevice) return "origin-device-removed" as const;
  if (
    origin.originDeviceLastKnownUniqueId &&
    originDevice.lastKnownUniqueId &&
    origin.originDeviceLastKnownUniqueId !== originDevice.lastKnownUniqueId
  ) {
    return "origin-device-mismatch" as const;
  }
  return null;
};

export const fetchUltimateOriginBlob = async (origin: DeviceBoundContentOrigin): Promise<Blob> => {
  const originDevice = getSavedDeviceById(origin.originDeviceId);
  if (!originDevice) {
    throw new Error("Original device is no longer saved. Re-import or remove this item.");
  }
  if (
    origin.originDeviceLastKnownUniqueId &&
    originDevice.lastKnownUniqueId &&
    origin.originDeviceLastKnownUniqueId !== originDevice.lastKnownUniqueId
  ) {
    throw new Error("Original device identity changed. Re-import or remove this item.");
  }

  const password = (await getPasswordForDevice(origin.originDeviceId)) ?? "";
  try {
    const response = await readFtpFile({
      host: normalizeFtpHost(originDevice.host),
      port: originDevice.ftpPort,
      password,
      path: normalizeOriginPath(origin.originPath),
    });
    const bytes = base64ToUint8(response.data);
    return new Blob([bytes], { type: "application/octet-stream" });
  } catch (error) {
    throw new Error(`Original device content is unavailable: ${(error as Error).message}`);
  }
};
