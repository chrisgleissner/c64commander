/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import type { PlaylistItem } from "@/pages/playFiles/types";
import { addErrorLog, addLog } from "@/lib/logging";

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`).toLowerCase();

/**
 * The MD5 that HVSC's `Songlengths.md5` lists for this exact path, or null when it lists none.
 * It is the file's own digest in a real release and the corpus identity in Demo Mode's generated one,
 * whose files cannot hash to a corpus identity.
 */
const listedHvscMd5 = async (virtualPath: string): Promise<string | null> => {
  try {
    const { resolveHvscSonglengthDuration } = await import("@/lib/hvsc/hvscSongLengthService");
    const resolution = await resolveHvscSonglengthDuration({ virtualPath });
    if (!resolution.matchedMd5 || !resolution.matchedPath) return null;
    return normalizePath(resolution.matchedPath) === normalizePath(virtualPath) ? resolution.matchedMd5 : null;
  } catch (error) {
    addLog("warn", "Songlengths lookup for the ranking MD5 failed; hashing the tune instead", {
      virtualPath,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return null;
  }
};

/**
 * Resolves the current tune's **full MD5** (the ranking key, spec §5.1) once per tune. An HVSC tune
 * uses the digest its archive lists for the path; anything else, or an HVSC tune the list does not
 * name, hashes its SID bytes with `computeSidMd5`. Only runs when `enabled` (sidRankingEnabled);
 * items with neither an HVSC path nor local bytes yield null and the affordance stays inert.
 */
export const useCurrentTuneMd5 = (item: PlaylistItem | null, enabled: boolean): string | null => {
  const [md5, setMd5] = useState<string | null>(null);
  const isSid = item?.category === "sid";
  const file = isSid ? item.request?.file : undefined;
  const hvscPath = isSid && item.request?.source === "hvsc" ? (item.request.path ?? item.path ?? null) : null;
  const itemKey = item?.id ?? null;

  useEffect(() => {
    setMd5(null);
    if (!enabled || (!file && !hvscPath)) return;
    let cancelled = false;
    void (async () => {
      try {
        let digest = hvscPath ? await listedHvscMd5(hvscPath) : null;
        if (!digest && file) {
          const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
          digest = await computeSidMd5(await file.arrayBuffer());
        }
        if (!cancelled) setMd5(digest);
      } catch (error) {
        addErrorLog("Failed to compute SID MD5 for ranking", { error: (error as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // itemKey changes per tune; file identity tracks the underlying bytes.
  }, [enabled, file, hvscPath, itemKey]);

  return md5;
};
