/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { resetSonglengthsCache } from "./hvscFilesystem";
import { beginHvscPerfScope, endHvscPerfScope } from "./hvscPerformance";
import { reloadHvscSonglengthsOnConfigChange } from "./hvscSongLengthService";

/**
 * Reloads the song lengths once the native ingest has put the library on disk. Forced because the
 * installed version is committed only afterwards, so discovery must not gate on the install state.
 */
export const reloadSonglengthsAfterNativeIngest = async (scope: {
  archiveName: string;
  archiveType: string;
  archiveVersion: number;
}) => {
  resetSonglengthsCache();
  const perfScope = beginHvscPerfScope("ingest:songlengths", { ...scope, mode: "native" });
  let perfError: Error | null = null;
  try {
    await reloadHvscSonglengthsOnConfigChange({ force: true });
  } catch (error) {
    perfError = error as Error;
    throw error;
  } finally {
    endHvscPerfScope(
      perfScope,
      perfError ? { outcome: "error", errorMessage: perfError.message } : { outcome: "success" },
    );
  }
};
