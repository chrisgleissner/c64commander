/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beginHvscInstallGuard } from "@/lib/hvsc/hvscInstallGuard";
import { cleanupStaleStagingDir, ensureHvscDirs } from "./hvscFilesystem";
import {
  getHvscIngestionRuntimeState,
  markIngestionRuntimeIdle,
  recordStateBeforeIngestion,
} from "./hvscIngestionRuntimeSupport";

/**
 * The storage steps an ingestion takes after claiming the runtime and before the `try` whose `finally`
 * releases it. A failing directory create left the claim held, and every later install, update and
 * reset answered "already running" until the app restarted.
 */
export const prepareIngestionStorage = async (cancelToken: string) => {
  const { cancelTokens } = getHvscIngestionRuntimeState();
  recordStateBeforeIngestion();
  try {
    await ensureHvscDirs();
    await cleanupStaleStagingDir();
    // The runtime is already claimed, so a token present here is a cancel that arrived during these steps.
    if (!cancelTokens.has(cancelToken)) cancelTokens.set(cancelToken, { cancelled: false });
    await beginHvscInstallGuard();
  } catch (error) {
    cancelTokens.delete(cancelToken);
    markIngestionRuntimeIdle();
    throw new Error(`HVSC ingestion could not prepare its storage: ${(error as Error).message}`, { cause: error });
  }
};
