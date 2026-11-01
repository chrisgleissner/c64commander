/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { addLog } from "@/lib/logging";
import { fetchContentLength } from "@/lib/hvsc/hvscDownload";
import { buildHvscBaselineUrl, fetchLatestHvscVersions } from "@/lib/hvsc/hvscReleaseService";

export const HVSC_SIZE_LOOKUP_TIMEOUT_MS = 5000;

/** The size of the newest baseline archive from the HVSC host, or null when it cannot be read in time. */
export const fetchHvscBaselineSizeBytes = async (): Promise<number | null> => {
  const lookup = (async () => {
    const { baselineVersion } = await fetchLatestHvscVersions();
    return baselineVersion > 0 ? await fetchContentLength(buildHvscBaselineUrl(baselineVersion)) : null;
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), HVSC_SIZE_LOOKUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([lookup, timeout]);
  } catch (error) {
    addLog("warn", "Could not read the size of the HVSC archive", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Asks the HVSC host for the archive size once, and only while `wanted`: after the person opened the consent. */
export const useHvscArchiveSize = (wanted: boolean): number | null => {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    void fetchHvscBaselineSizeBytes().then((value) => {
      if (current) setBytes(value);
    });
    return () => {
      current = false;
    };
  }, [wanted]);
  return bytes;
};
