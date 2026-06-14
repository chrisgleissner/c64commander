/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §15.1 — Config drift: diff runtime config against persisted (flash) config.
// This is a strictly READ-ONLY diagnostics view and must never mutate device state.

import { addLog } from "@/lib/logging";

export type ConfigDriftItem = {
  category: string;
  item: string;
  runtimeValue: string;
  persistedValue: string;
};

export type ConfigDriftResult = {
  timestamp: string;
  driftItems: ConfigDriftItem[];
  /** Non-empty when drift could not be computed */
  error: string | null;
};

/**
 * §15.1 — Compute runtime-vs-persisted config drift.
 *
 * Config Drift is a diagnostics surface and MUST NOT mutate device state. A true
 * runtime-vs-persisted comparison would require reading the flash-saved config, but
 * the C64 Ultimate / Ultimate 64 firmware exposes no non-destructive persisted-config
 * read: the only way to surface the saved state is `PUT /v1/configs:load_from_flash`,
 * which OVERWRITES the running config and silently discards any unsaved runtime changes.
 *
 * The previous implementation invoked that destructive load on every open/refresh
 * (BUG-034) — a hidden device mutation from a read-only "compare" panel, compounded by
 * an unpaced ~2N+1 request burst that tripped c64u "Connection reset". Until the firmware
 * offers a non-destructive persisted read (or the app maintains its own saved snapshot to
 * diff against), drift comparison is reported as unavailable rather than performed
 * destructively. This issues NO device requests and is safe to auto-run on mount.
 */
export const computeConfigDrift = async (): Promise<ConfigDriftResult> => {
  const timestamp = new Date().toISOString();
  addLog("info", "Config drift comparison unavailable (read-only: no non-destructive persisted-config source)");
  return {
    timestamp,
    driftItems: [],
    error:
      "Persisted-config comparison is unavailable on this firmware. Reading the saved (flash) config would require a destructive reload that discards unsaved runtime changes, so Config Drift stays read-only.",
  };
};
