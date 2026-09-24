/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import { getLocalFilePath } from "@/pages/playFiles/playFilesUtils";
import { resolveHvscDurationSecondsForSongNr } from "@/pages/playFiles/sidBytesAhead";

type ResolveSonglengthDurationMsForPath = (
  path: string,
  file: LocalPlayFile | null,
  songNr: number | null,
) => Promise<number | null>;

export const resolveLocalSidMetadata = async (
  file: LocalPlayFile | undefined,
  songNr: number | null | undefined,
  durationFallbackMs: number,
  resolveSonglengthDurationMsForPath: ResolveSonglengthDurationMsForPath,
) => {
  if (!file)
    return {
      durationMs: undefined,
      subsongCount: undefined,
      readable: false,
    } as const;
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    addErrorLog("Failed to read local SID file", {
      error: (error as Error).message,
    });
    return {
      durationMs: durationFallbackMs,
      subsongCount: undefined,
      readable: false,
    } as const;
  }
  const { getSidSongCount } = await import("@/lib/sid/sidUtils");
  const subsongCount = getSidSongCount(buffer);

  try {
    const filePath = getLocalFilePath(file);
    const localDurationMs = await resolveSonglengthDurationMsForPath(filePath, file, songNr ?? null);
    if (localDurationMs !== null) {
      return {
        durationMs: localDurationMs,
        subsongCount,
        readable: true,
      } as const;
    }

    const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
    const md5 = await computeSidMd5(buffer);
    const seconds = await resolveHvscDurationSecondsForSongNr(md5, songNr);
    const durationMs = seconds !== undefined && seconds !== null ? seconds * 1000 : durationFallbackMs;
    return { durationMs, subsongCount, readable: true } as const;
  } catch (error) {
    addErrorLog("Failed to resolve SID metadata", {
      error: (error as Error).message,
      file: file.name,
    });
    return {
      durationMs: durationFallbackMs,
      subsongCount,
      readable: true,
    } as const;
  }
};
