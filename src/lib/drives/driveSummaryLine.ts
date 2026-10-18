/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { driveCardTitleVariants } from "./driveDevices";

export const NO_DISK_SUMMARY = "No disk";

/** Thin spaces: with ordinary ones "A · #8 · 1541 · No disk" needs 6 px more than the 320 px screen leaves it. */
export const SUMMARY_SEPARATOR = "\u2009·\u2009";

export type DriveSummaryInput = {
  name: string;
  busId: string;
  type?: string;
  mountedPath?: string;
  loading: boolean;
  loadingLabel: string;
};

const MOUNTED_LABEL_NONE = /^no disk mounted$/i;

/** The disk or folder name without its directory, so the line shows what is mounted and not where it lives. */
export const summarizeMountedName = (mountedPath: string | undefined): string => {
  const trimmed = mountedPath?.trim() ?? "";
  if (!trimmed || MOUNTED_LABEL_NONE.test(trimmed)) return NO_DISK_SUMMARY;
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : trimmed;
};

/** One line per drive: "A · #8 · 1541 · disk name". The Soft IEC drive has no type, so its line omits it. */
export const buildDriveSummaryLine = ({
  name,
  busId,
  type,
  mountedPath,
  loading,
  loadingLabel,
}: DriveSummaryInput): string => {
  const variants = driveCardTitleVariants(name);
  const parts = [variants[variants.length - 1], `#${busId}`];
  if (type) parts.push(type);
  parts.push(loading ? loadingLabel : summarizeMountedName(mountedPath));
  return parts.join(SUMMARY_SEPARATOR);
};
