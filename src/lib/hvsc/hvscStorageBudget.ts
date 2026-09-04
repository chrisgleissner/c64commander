/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { HvscIngestion } from "@/lib/native/hvscIngestion";

/**
 * Bytes the extracted library occupies per byte of compressed archive.
 *
 * Measured on the Pixel 4 rig against an installed HVSC baseline: the retained
 * archive under `files/hvsc/cache` was 82,932 KB and the extracted
 * `files/hvsc/library` was 458,364 KB, a ratio of 5.53. The value is rounded up
 * so the estimate stays on the safe side as HVSC grows between releases.
 */
export const HVSC_LIBRARY_EXPANSION_FACTOR = 6;

/**
 * Library trees the install has to make room for, which is one whether or not a
 * library is already installed.
 *
 * A baseline reinstall does keep two trees on disk at once — the extractor
 * writes into `hvsc/library-staging`, and promotion renames the live library to
 * `hvsc/library-old` before renaming staging into place
 * (`HvscIngestionPlugin.promoteBaselineLibrary`) — but the existing tree is
 * already occupying its space, and the figure this is compared against is FREE
 * space. Charging the resident library against free space again asked a
 * reinstall for roughly twice what it needs and refused installs that fit.
 */
export const librariesToMakeRoomFor = () => 1;

export type HvscStorageEstimate = {
  requiredBytes: number;
  archiveBytes: number;
  librariesResident: number;
};

/**
 * Free disk the install needs: the downloaded archive, which is retained in the
 * cache, plus the one library tree the extractor is about to create.
 */
export const estimateHvscInstallBytes = (archiveBytes: number): HvscStorageEstimate => {
  const librariesResident = librariesToMakeRoomFor();
  return {
    archiveBytes,
    librariesResident,
    requiredBytes: archiveBytes + archiveBytes * HVSC_LIBRARY_EXPANSION_FACTOR * librariesResident,
  };
};

const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;

export const buildInsufficientStorageMessage = (requiredBytes: number, availableBytes: number) =>
  `Not enough free space to install the HVSC library. It needs about ${formatBytes(requiredBytes)} ` +
  `while this device has ${formatBytes(availableBytes)} free. Free up space and try again.`;

export type StorageBudgetReader = () => Promise<{ availableBytes: number; libraryPresent: boolean }>;

/**
 * Refuses an install that cannot fit, before the archive is downloaded.
 *
 * The check is advisory in both directions it cannot see: when the archive size
 * is unknown (the origin served no `Content-Length`) or the platform exposes no
 * storage budget, it declines to block rather than guessing, because a false
 * refusal costs the user the whole feature while a missed one costs a retry.
 */
export const ensureRoomForHvscInstall = async (options: {
  archiveBytes: number | null;
  readBudget?: StorageBudgetReader;
}) => {
  const { archiveBytes } = options;
  if (!archiveBytes || archiveBytes <= 0) return;
  const readBudget = options.readBudget ?? HvscIngestion.getStorageBudget;

  let budget: { availableBytes: number; libraryPresent: boolean };
  try {
    budget = await readBudget();
  } catch (error) {
    addLog("warn", "HVSC storage budget unavailable; skipping free-space check", {
      error: (error as Error).message,
    });
    return;
  }
  if (!Number.isFinite(budget?.availableBytes) || budget.availableBytes <= 0) return;

  const estimate = estimateHvscInstallBytes(archiveBytes);
  addLog("info", "HVSC storage budget checked", {
    archiveBytes,
    requiredBytes: estimate.requiredBytes,
    availableBytes: budget.availableBytes,
    librariesResident: estimate.librariesResident,
    libraryPresent: budget.libraryPresent,
  });
  if (budget.availableBytes >= estimate.requiredBytes) return;

  throw new Error(buildInsufficientStorageMessage(estimate.requiredBytes, budget.availableBytes));
};
