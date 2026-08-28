/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";

import { registerSearchEntries } from "@/lib/search/registry";
import { TIER1_SOURCES } from "@/lib/search/tier1";
import { subscribeSavedDevices } from "@/lib/savedDevices/store";
import { subscribeSearchOpen } from "@/lib/search/overlayState";

/**
 * Publishes tier 1 into the search registry (spec.md section 5.4).
 *
 * Two triggers, because the three sources report changes differently. Saved devices have a store
 * subscription. Liked tunes and recently played are localStorage, written by pages that do not
 * announce it, so they are re-read when the overlay is asked for — which is the only moment their
 * contents can matter, and is off the keystroke path.
 *
 * Mounted by SearchOverlayHost rather than the overlay itself: the overlay is lazy, and entries
 * that only exist once its chunk has loaded would be missing from the first query of every launch.
 */
export const useTier1SearchEntries = (): void => {
  useEffect(() => {
    const publish = () => {
      for (const [key, build] of Object.entries(TIER1_SOURCES)) registerSearchEntries(key, build());
    };
    publish();
    const stopDevices = subscribeSavedDevices(publish);
    const stopOpen = subscribeSearchOpen(publish);
    return () => {
      stopDevices();
      stopOpen();
      for (const key of Object.keys(TIER1_SOURCES)) registerSearchEntries(key, []);
    };
  }, []);
};
