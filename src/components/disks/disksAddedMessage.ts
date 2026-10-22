/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** What the notice after adding disks says: the count, then what could not be done. */
export const describeDisksAdded = (count: number, skippedFolders: boolean, settingsNotice: string) =>
  [
    skippedFolders
      ? `${count} disk(s) added. Some folders could not be scanned.`
      : `${count} disk(s) added to library.`,
    settingsNotice,
  ]
    .filter(Boolean)
    .join(" ");
