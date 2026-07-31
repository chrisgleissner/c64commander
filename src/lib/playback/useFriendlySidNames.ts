/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { loadFriendlySidNames } from "@/lib/config/appSettings";

/**
 * Reactive "Friendly SID names" preference (re-reads on the app-settings broadcast).
 *
 * Reactive rather than read-once because the preference is changed on a different screen: without
 * the subscription the Play screen would keep drawing whichever form it happened to mount with
 * until it remounted, and the Settings toggle would look as though it had done nothing.
 */
export const useFriendlySidNames = (): boolean => {
  const [enabled, setEnabled] = useState(loadFriendlySidNames);
  useEffect(() => {
    const handler = () => setEnabled(loadFriendlySidNames());
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);
  return enabled;
};
