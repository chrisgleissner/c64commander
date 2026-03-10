/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import { normalizeLocalPath } from "@/pages/playFiles/playFilesUtils";

export type SonglengthResolverService = {
  resolveDurationSeconds: (request: {
    virtualPath: string;
    fileName: string | null;
    md5?: string;
    songNr: number | null;
  }) => { durationSeconds: number | null };
};

export type SonglengthResolutionOptions = {
  allowMd5Fallback?: boolean;
};

export const resolveSonglengthDurationMsWithFacade = async ({
  service,
  path,
  file,
  songNr,
  options,
  computeSidMd5,
}: {
  service: SonglengthResolverService;
  path: string;
  file?: LocalPlayFile | null;
  songNr?: number | null;
  options?: SonglengthResolutionOptions;
  computeSidMd5?: (buffer: ArrayBuffer) => Promise<string>;
}) => {
  const normalizedPath = normalizeLocalPath(path || "/");
  const fileName = normalizedPath.split("/").pop() ?? null;
  const resolvedByPath = service.resolveDurationSeconds({
    virtualPath: normalizedPath,
    fileName,
    songNr: songNr ?? null,
  });
  if (resolvedByPath.durationSeconds !== null) {
    return resolvedByPath.durationSeconds * 1000;
  }
  if (!file || options?.allowMd5Fallback === false) return null;
  try {
    const buffer = await file.arrayBuffer();
    const resolveMd5 =
      computeSidMd5 ??
      (async (input: ArrayBuffer) => {
        const { computeSidMd5: importedComputeSidMd5 } = await import("@/lib/sid/sidUtils");
        return importedComputeSidMd5(input);
      });
    const md5 = await resolveMd5(buffer);
    const resolvedByMd5 = service.resolveDurationSeconds({
      virtualPath: normalizedPath,
      fileName,
      md5,
      songNr: songNr ?? null,
    });
    return resolvedByMd5.durationSeconds !== null ? resolvedByMd5.durationSeconds * 1000 : null;
  } catch (error) {
    addErrorLog("Failed to resolve songlength via facade md5 fallback", {
      path: normalizedPath,
      songNr: songNr ?? null,
      error: (error as Error).message,
    });
    return null;
  }
};
