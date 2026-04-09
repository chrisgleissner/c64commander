/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { DISK_IMAGE_EXTENSIONS, getFileExtension } from "@/lib/playback/fileTypes";
import type { ConfigFileReference } from "@/lib/config/configFileReference";
import type { ConfigCandidate, ConfigResolutionOrigin, ConfigValueOverride } from "@/lib/config/playbackConfig";
import { buildSelectedDeviceBoundOrigin, type DeviceBoundContentOrigin } from "@/lib/savedDevices/deviceBoundOrigin";

export type DiskLocation = "local" | "ultimate";

export type DiskEntry = {
  id: string;
  name: string;
  path: string;
  location: DiskLocation;
  origin?: DeviceBoundContentOrigin | null;
  group: string | null;
  sourceId?: string | null;
  localUri?: string | null;
  localTreeUri?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  importedAt: string;
  importOrder?: number | null;
  configRef?: ConfigFileReference | null;
  configOrigin?: ConfigResolutionOrigin | null;
  configOverrides?: ConfigValueOverride[] | null;
  configCandidates?: ConfigCandidate[] | null;
};

export type DiskLocationLabel = "Local" | "C64U";

export const normalizeDiskPath = (value: string) => {
  if (!value) return "/";
  const trimmed = value.replace(/\s+/g, " ").trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+/g, "/");
};

export const buildDiskId = (location: DiskLocation, path: string) => `${location}:${normalizeDiskPath(path)}`;

export const getDiskName = (path: string) => {
  const normalized = normalizeDiskPath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

export const getDiskFolderPath = (path: string) => {
  const normalized = normalizeDiskPath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}/`;
};

export const isDiskImagePath = (path: string) => DISK_IMAGE_EXTENSIONS.has(getFileExtension(path));

export const getLeafFolderName = (path: string) => {
  const normalized = normalizeDiskPath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (isDiskImagePath(normalized)) {
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  }
  return parts[parts.length - 1] || null;
};

export const createDiskEntry = (params: {
  path: string;
  location: DiskLocation;
  origin?: DeviceBoundContentOrigin | null;
  group?: string | null;
  sourceId?: string | null;
  localUri?: string | null;
  localTreeUri?: string | null;
  name?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  importOrder?: number | null;
  configRef?: ConfigFileReference | null;
  configOrigin?: ConfigResolutionOrigin | null;
  configOverrides?: ConfigValueOverride[] | null;
  configCandidates?: ConfigCandidate[] | null;
}): DiskEntry => {
  const path = normalizeDiskPath(params.path);
  return {
    id: buildDiskId(params.location, path),
    name: params.name?.trim() || getDiskName(path),
    path,
    location: params.location,
    origin: params.origin ?? (params.location === "ultimate" ? buildSelectedDeviceBoundOrigin(path) : null),
    group: params.group ?? null,
    sourceId: params.sourceId ?? null,
    localUri: params.localUri ?? null,
    localTreeUri: params.localTreeUri ?? null,
    sizeBytes: params.sizeBytes ?? null,
    modifiedAt: params.modifiedAt ?? null,
    importedAt: new Date().toISOString(),
    importOrder: params.importOrder ?? null,
    configRef: params.configRef ?? null,
    configOrigin: params.configOrigin ?? null,
    configOverrides: params.configOverrides ?? null,
    configCandidates: params.configCandidates ?? null,
  };
};

export const getLocationLabel = (location: DiskLocation): DiskLocationLabel =>
  location === "local" ? "Local" : "C64U";
