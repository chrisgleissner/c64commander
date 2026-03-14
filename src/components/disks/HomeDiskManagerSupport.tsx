/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FileOriginIcon } from "@/components/FileOriginIcon";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { normalizeDiskPath, type DiskEntry } from "@/lib/disks/diskTypes";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { getDiagnosticsColorClassForDisplaySeverity } from "@/lib/diagnostics/diagnosticsSeverity";
import type { DriveDeviceClass } from "@/lib/drives/driveDevices";

export const DRIVE_KEYS = ["a", "b"] as const;

export type DriveKey = (typeof DRIVE_KEYS)[number];

export const buildDriveLabel = (key: DriveKey) => `Drive ${key.toUpperCase()}`;

export const DRIVE_CONFIG_CATEGORY: Record<DriveKey, string> = {
  a: "Drive A Settings",
  b: "Drive B Settings",
};

export const DRIVE_BUS_ID_ITEM = "Drive Bus ID";
export const DRIVE_TYPE_ITEM = "Drive Type";
export const DRIVE_BUS_ID_DEFAULTS = [8, 9, 10, 11] as const;
export const DRIVE_TYPE_DEFAULTS = ["1541", "1571", "1581"] as const;
export const DRIVE_DEFAULT_BUS_ID: Record<DriveKey, number> = { a: 8, b: 9 };
export const DRIVE_DEFAULT_TYPE = "1541";
export const SOFT_IEC_DEFAULT_PATH_ITEM = "Default Path";
export const SOFT_IEC_DEFAULT_PATH_FALLBACK = "/USB0/";
export const SOFT_IEC_BUS_ID_DEFAULTS = Array.from({ length: 23 }, (_, index) => index + 8);
export const ROW1_CONTROL_CLASS = "h-9 w-14 rounded-md px-0 text-xs font-semibold";
export const INLINE_META_SELECT_CLASS =
  "h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none focus:ring-1 focus:ring-ring data-[state=open]:border-border data-[state=open]:bg-background";
export const SOFT_IEC_CONTROL = {
  class: "SOFT_IEC_DRIVE" as DriveDeviceClass,
  category: "SoftIEC Drive Settings",
  enabledItem: "IEC Drive",
  busItem: "Soft Drive Bus ID",
};

export const buildDrivePath = (path?: string | null, file?: string | null) => {
  if (!file) return null;
  const base = normalizeDiskPath(path || "/");
  return base.endsWith("/") ? `${base}${file}` : `${base}/${file}`;
};

export const normalizeDirectoryPath = (value: string) => {
  const normalized = normalizeSourcePath(value || "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

export const LocationIcon = ({ location }: { location: DiskEntry["location"] }) => (
  <FileOriginIcon
    origin={location === "local" ? "local" : "ultimate"}
    className="h-4 w-4 shrink-0 opacity-60"
    label={location === "local" ? "Local disk" : "C64U disk"}
  />
);

export const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
};

export const resolveSoftIecServiceError = (value?: string | null) => {
  const message = value?.trim();
  if (!message) return "";
  if (/^service error reported\.?$/i.test(message)) return "";
  return message;
};

export const resolveDriveStatusRaw = (primary?: string | null, fallback?: string | null) => {
  if (typeof primary === "string" && primary.trim().length) return primary;
  if (typeof fallback === "string" && fallback.trim().length) return fallback;
  return "";
};

export const getCategoryConfigValue = (payload: unknown, categoryName: string, itemName: string) => {
  const record = payload as Record<string, unknown> | undefined;
  const categoryBlock = record?.[categoryName] as Record<string, unknown> | undefined;
  const itemsBlock = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
  if (!itemsBlock || !Object.prototype.hasOwnProperty.call(itemsBlock, itemName)) return undefined;
  return normalizeConfigItem(itemsBlock[itemName]).value;
};

export const getDriveConfigValue = (payload: unknown, drive: DriveKey, itemName: string) =>
  getCategoryConfigValue(payload, DRIVE_CONFIG_CATEGORY[drive], itemName);

export const parseBusId = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const numeric = typeof normalized === "number" ? normalized : Number(String(normalized));
  if (!Number.isInteger(numeric)) return null;
  return numeric;
};

export const parseDriveType = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
};

export const resolveDriveBusId = (drive: DriveKey, payload: unknown, fallbackInfo?: { bus_id?: number }) => {
  const fromConfig = parseBusId(getDriveConfigValue(payload, drive, DRIVE_BUS_ID_ITEM));
  if (fromConfig !== null) return fromConfig;
  const fromDriveInfo = parseBusId(fallbackInfo?.bus_id);
  if (fromDriveInfo !== null) return fromDriveInfo;
  return DRIVE_DEFAULT_BUS_ID[drive];
};

export const resolveDriveType = (drive: DriveKey, payload: unknown, fallbackInfo?: { type?: string }) => {
  const fromConfig = parseDriveType(getDriveConfigValue(payload, drive, DRIVE_TYPE_ITEM));
  if (fromConfig) return fromConfig;
  const fromDriveInfo = parseDriveType(fallbackInfo?.type);
  if (fromDriveInfo) return fromDriveInfo;
  return DRIVE_DEFAULT_TYPE;
};

export const resolveSoftIecDefaultPath = (payload: unknown, fallbackPath?: string | null) => {
  const fromConfig = String(
    getCategoryConfigValue(payload, SOFT_IEC_CONTROL.category, SOFT_IEC_DEFAULT_PATH_ITEM) ?? "",
  ).trim();
  if (fromConfig.length) return normalizeDirectoryPath(fromConfig);
  if (fallbackPath && fallbackPath.trim()) return normalizeDirectoryPath(fallbackPath);
  return SOFT_IEC_DEFAULT_PATH_FALLBACK;
};

export const resolveStatusDisplaySeverity = (status: {
  severity: "INFO" | "WARN" | "ERROR";
  message: string | null;
}) => {
  return status.severity;
};

export const getStatusMessageColorClass = (status: { severity: "INFO" | "WARN" | "ERROR"; message: string | null }) => {
  if (status.message === "OK") return "text-success";
  return getDiagnosticsColorClassForDisplaySeverity(status.severity);
};
