/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §8.2 — Recent successful switch-device targets (up to 3).

const MAX_RECENT = 3;
const STORAGE_KEY = "c64u_recent_switch_targets";

export type RecentTarget = {
  host: string;
  /** Optional model label if known, e.g. "U64E2" */
  modelLabel?: string;
};

const read = (): RecentTarget[] => {
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as RecentTarget[]).filter(
      (t) => t && typeof t === "object" && typeof t.host === "string" && t.host.length > 0,
    );
  } catch {
    return [];
  }
};

const write = (targets: RecentTarget[]): void => {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
    }
  } catch {
    // storage unavailable — ignore
  }
};

/** Prepend a successful switch target, capping at MAX_RECENT. Deduplicates by host. */
export const recordRecentTarget = (host: string, modelLabel?: string): void => {
  const current = read().filter((t) => t.host !== host);
  const updated: RecentTarget[] = [{ host, modelLabel }, ...current].slice(0, MAX_RECENT);
  write(updated);
};

/** Get the list of recent targets (newest first, up to MAX_RECENT). */
export const getRecentTargets = (): RecentTarget[] => read();

/** Clear the recent target list. */
export const clearRecentTargets = (): void => write([]);
