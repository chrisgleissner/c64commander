/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { loadSidRadioEnabled, loadSidRankingEnabled } from "@/lib/config/appSettings";

export interface SidRadioFlags {
  /** Master flag. */
  sidRadioEnabled: boolean;
  /** ♥/✕ affordance flag (follows master, spec §0.4). */
  sidRankingEnabled: boolean;
  /** True when the ambient ranking affordance should be shown (both on). */
  rankingActive: boolean;
}

const read = (): SidRadioFlags => {
  const sidRadioEnabled = loadSidRadioEnabled();
  const sidRankingEnabled = loadSidRankingEnabled();
  return { sidRadioEnabled, sidRankingEnabled, rankingActive: sidRadioEnabled && sidRankingEnabled };
};

/** Reactive SID Radio feature flags (re-reads on the app-settings broadcast). */
export const useSidRadioFlags = (): SidRadioFlags => {
  const [flags, setFlags] = useState<SidRadioFlags>(read);
  useEffect(() => {
    const handler = () => setFlags(read());
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);
  return flags;
};
