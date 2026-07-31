/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { addErrorLog } from "@/lib/logging";
import { getLikedMd5s, loadRankings, subscribeRankings } from "@/lib/sidRadio/rankingStore";

/**
 * How many tunes the user has ♥-liked, kept current.
 *
 * The launcher gates Taste Radio on this count (D1), and it used to be read straight from the
 * synchronous cache on whatever render happened to run. That cache is hydrated asynchronously, so a
 * relaunched app offered "Like a few tunes to unlock (0/5)" to a user who had already liked dozens,
 * and only a re-render for some unrelated reason corrected it. Hydrating and subscribing here makes
 * the count follow the store instead of the render schedule.
 */
export const useLikedTuneCount = (): number => {
  const [count, setCount] = useState<number>(() => getLikedMd5s().length);

  useEffect(() => {
    const refresh = () => setCount(getLikedMd5s().length);
    refresh();
    const unsubscribe = subscribeRankings(refresh);
    loadRankings()
      .then(refresh)
      .catch((error: unknown) => {
        addErrorLog("Failed to hydrate SID rankings for the liked-tune count", {
          error: (error as Error).message,
        });
      });
    return unsubscribe;
  }, []);

  return count;
};
