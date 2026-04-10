/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { listFtpDirectory, readFtpFile } from "@/lib/ftp/ftpClient";
import { normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { getPasswordForDevice } from "@/lib/secureStorage";
import { getSavedDeviceById, getSelectedSavedDevice } from "./store";

export type OriginDeviceUnavailableReason =
  | "origin-device-unreachable"
  | "origin-device-removed"
  | "origin-device-mismatch"
  | "origin-file-missing";

export type DeviceBoundContentOrigin = {
  sourceKind: "ultimate";
  originDeviceId: string;
  originDeviceLastKnownUniqueId: string | null;
  originPath: string;
  importedAt: string;
};

export class OriginContentUnavailableError extends Error {
  readonly reason: OriginDeviceUnavailableReason;

  constructor(reason: OriginDeviceUnavailableReason, message: string) {
    super(message);
    this.name = "OriginContentUnavailableError";
    this.reason = reason;
  }
}

const normalizeOriginPath = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const ORIGIN_CONNECTIVITY_FAILURE_PATTERN =
  /host unreachable|service unavailable|http 503|failed to fetch|request timed out|networkerror|dns|timed out|connection reset|econnreset|econnrefused|connection refused/i;

const ORIGIN_FILE_MISSING_PATTERN = /550|not found|no such file/i;

const getOriginParentPath = (originPath: string) => {
  const normalized = normalizeOriginPath(originPath);
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex <= 0) return "/";
  return normalized.slice(0, lastSlashIndex) || "/";
};

const getOriginFileName = (originPath: string) => {
  const normalized = normalizeOriginPath(originPath);
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
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
    throw new OriginContentUnavailableError(
      "origin-device-removed",
      "Original device is no longer saved. Re-import or remove this item.",
    );
  }
  if (
    origin.originDeviceLastKnownUniqueId &&
    originDevice.lastKnownUniqueId &&
    origin.originDeviceLastKnownUniqueId !== originDevice.lastKnownUniqueId
  ) {
    throw new OriginContentUnavailableError(
      "origin-device-mismatch",
      "Original device identity changed. Re-import or remove this item.",
    );
  }

  const password = (await getPasswordForDevice(origin.originDeviceId)) ?? "";
  const normalizedPath = normalizeOriginPath(origin.originPath);
  const ftpAccess = {
    host: normalizeFtpHost(originDevice.host),
    port: originDevice.ftpPort,
    password,
  };
  try {
    const response = await readFtpFile({
      host: ftpAccess.host,
      port: ftpAccess.port,
      password,
      path: normalizedPath,
    });
    const bytes = base64ToUint8(response.data);
    return new Blob([bytes], { type: "application/octet-stream" });
  } catch (error) {
    const message = (error as Error).message || "Original device content is unavailable.";
    if (ORIGIN_CONNECTIVITY_FAILURE_PATTERN.test(message)) {
      throw new OriginContentUnavailableError(
        "origin-device-unreachable",
        "Original device is unreachable. Reconnect or switch back to that device.",
      );
    }
    if (ORIGIN_FILE_MISSING_PATTERN.test(message)) {
      throw new OriginContentUnavailableError(
        "origin-file-missing",
        "Original file is no longer present on that device. Re-import or remove this item.",
      );
    }

    try {
      const parentPath = getOriginParentPath(normalizedPath);
      const fileName = getOriginFileName(normalizedPath);
      const listing = await listFtpDirectory({
        host: ftpAccess.host,
        port: ftpAccess.port,
        password,
        path: parentPath,
      });
      const fileStillExists = listing.entries.some(
        (entry) =>
          entry.type === "file" &&
          (normalizeOriginPath(entry.path) === normalizedPath ||
            entry.name.trim().toLowerCase() === fileName.toLowerCase()),
      );
      if (!fileStillExists) {
        throw new OriginContentUnavailableError(
          "origin-file-missing",
          "Original file is no longer present on that device. Re-import or remove this item.",
        );
      }
    } catch (listingError) {
      if (listingError instanceof OriginContentUnavailableError) {
        throw listingError;
      }
      const listingMessage = (listingError as Error).message || "";
      if (ORIGIN_CONNECTIVITY_FAILURE_PATTERN.test(listingMessage)) {
        throw new OriginContentUnavailableError(
          "origin-device-unreachable",
          "Original device is unreachable. Reconnect or switch back to that device.",
        );
      }
    }

    throw new Error(`Original device content is unavailable: ${message}`);
  }
};
