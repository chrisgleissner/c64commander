/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import type { PlaylistItem } from "@/pages/playFiles/types";
import { addErrorLog } from "@/lib/logging";

/**
 * Resolves the current tune's **full MD5** (the ranking key, spec §5.1) once per
 * tune, by reading its SID bytes and hashing them — reusing `computeSidMd5`, the
 * same digest the app already computes for songlengths. Only runs when `enabled`
 * (sidRankingEnabled) and only for SID items that carry local bytes; other
 * sources yield null and the affordance stays inert. Cheap: one hash per tune
 * change, never on the render hot path.
 */
export const useCurrentTuneMd5 = (item: PlaylistItem | null, enabled: boolean): string | null => {
  const [md5, setMd5] = useState<string | null>(null);
  const file = item?.category === "sid" ? item.request?.file : undefined;
  const itemKey = item?.id ?? null;

  useEffect(() => {
    setMd5(null);
    if (!enabled || !file) return;
    let cancelled = false;
    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
        const digest = await computeSidMd5(buffer);
        if (!cancelled) setMd5(digest);
      } catch (error) {
        addErrorLog("Failed to compute SID MD5 for ranking", { error: (error as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // itemKey changes per tune; file identity tracks the underlying bytes.
  }, [enabled, file, itemKey]);

  return md5;
};
