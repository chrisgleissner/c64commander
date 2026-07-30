/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState } from "react";

import { addErrorLog } from "@/lib/logging";
import {
  type RankingSignal,
  clearRanking,
  getRanking,
  loadRankings,
  setRanking,
  subscribeRankings,
} from "@/lib/sidRadio/rankingStore";

export interface NowPlayingRankingState {
  ranking: RankingSignal | null;
  isLiked: boolean;
  isNotForMe: boolean;
  /** Toggle ♥: like if unrated/not-for-me, else clear. */
  toggleLike: () => void;
  /** Toggle ✕: mark not-for-me if unrated/liked, else clear. Returns true when it *newly* marks. */
  toggleNotForMe: () => boolean;
}

/**
 * Reactive ranking state for the currently-playing tune (spec §5.1), keyed by
 * its full MD5. Subscribes to `rankingStore` so the affordance stays in sync
 * across surfaces (e.g. Liked Tunes un-like). A null md5 (tune not yet resolved
 * / non-SID) yields an inert, unranked state.
 */
export const useNowPlayingRanking = (md5: string | null): NowPlayingRankingState => {
  const [ranking, setRankingState] = useState<RankingSignal | null>(() => (md5 ? getRanking(md5) : null));

  // The ratings are durable but the cache they are read from is not, and only a *write* used to
  // hydrate it. So a relaunched app showed every previously rated tune as unrated until the user
  // rated something, and then a stale ♥ appeared on whatever was playing at that moment.
  useEffect(() => {
    loadRankings().catch((error: unknown) => {
      addErrorLog("Failed to hydrate SID rankings", { error: (error as Error).message });
    });
  }, []);

  useEffect(() => {
    setRankingState(md5 ? getRanking(md5) : null);
    if (!md5) return;
    return subscribeRankings(() => setRankingState(getRanking(md5)));
  }, [md5]);

  const toggleLike = useCallback(() => {
    if (!md5) return;
    void (getRanking(md5) === "like" ? clearRanking(md5) : setRanking(md5, "like"));
  }, [md5]);

  const toggleNotForMe = useCallback((): boolean => {
    if (!md5) return false;
    if (getRanking(md5) === "notForMe") {
      void clearRanking(md5);
      return false;
    }
    void setRanking(md5, "notForMe");
    return true;
  }, [md5]);

  return {
    ranking,
    isLiked: ranking === "like",
    isNotForMe: ranking === "notForMe",
    toggleLike,
    toggleNotForMe,
  };
};
