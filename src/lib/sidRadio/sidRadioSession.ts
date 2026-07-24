/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { StationSeed } from "@/lib/sidRadio/stationEngine";

/**
 * Persisted active-station descriptor (spec §6.3, D15). Only the tiny tuple
 * needed to **recompute an identical continuation** on restart is stored — never
 * the full scored queue. The engine is deterministic in
 * `(seed, rankingSnapshot, shuffleSeed)`, so replaying with the same tuple + the
 * saved exclude set resumes exactly where the user left off.
 */
export interface SidRadioSessionDescriptor {
  seedKind: "song" | "style" | "taste";
  seedLabel: string;
  seed: StationSeed;
  styleFilter: number | null;
  shuffleSeed: number;
  rankingSnapshotId: string;
  excludeOrdinals: number[];
}

const SESSION_KEY = "c64u_sid_radio_session";

export const saveSidRadioSession = (descriptor: SidRadioSessionDescriptor): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(descriptor));
  } catch (error) {
    addErrorLog("Failed to persist SID Radio session", { error: (error as Error).message });
  }
};

export const loadSidRadioSession = (): SidRadioSessionDescriptor | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SidRadioSessionDescriptor;
    if (!parsed || typeof parsed !== "object" || !parsed.seed || !Array.isArray(parsed.excludeOrdinals)) {
      return null;
    }
    return parsed;
  } catch (error) {
    addErrorLog("Failed to read SID Radio session", { error: (error as Error).message });
    return null;
  }
};

export const clearSidRadioSession = (): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
};
