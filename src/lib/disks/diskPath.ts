/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const normalizeDiskPath = (value: string) => {
  if (!value) return "/";
  const trimmed = value.replace(/\s+/g, " ").trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+/g, "/");
};

const DISK_WORK_FILE_PREFIX = "c64commander-disk-work";

// A flat file under the persistent root, not a subdirectory: the native FTP plugin cannot create a folder, so
// STOR into a missing one fails (seen on c64u fw 1.1.0). One file per drive, reused by every materialized mount.
export const buildDiskWorkPath = (root: string, drive: "a" | "b", mountType: string) =>
  `/${root}/${DISK_WORK_FILE_PREFIX}-${drive}.${mountType}`;

export const isDiskWorkPath = (path: string) =>
  new RegExp(`^${DISK_WORK_FILE_PREFIX}-[ab]\\.[a-z0-9]+$`, "i").test(path.split("/").pop() ?? "");
