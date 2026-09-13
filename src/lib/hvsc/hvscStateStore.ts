/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HvscIngestionState, HvscStatus } from "./hvscTypes";
import { addLog } from "@/lib/logging";

type HvscUpdateRecord = {
  version: number;
  status: "success" | "failed" | "unknown";
  error?: string | null;
};

/**
 * Where the HVSC data on this device came from: the installed library and the archives cached for it.
 * "demo" is the invented release Demo Mode's simulated device serves; see `hvscLibrarySource.ts`.
 */
export type HvscLibrarySource = "real" | "demo";

export type HvscState = HvscStatus & {
  updates: Record<number, HvscUpdateRecord>;
  librarySource: HvscLibrarySource;
};

const STORAGE_KEY = "c64u_hvsc_state:v1";

const validIngestionStates = new Set<HvscIngestionState>(["idle", "installing", "updating", "ready", "error"]);

const toIngestionState = (value: unknown): HvscIngestionState =>
  typeof value === "string" && validIngestionStates.has(value as HvscIngestionState)
    ? (value as HvscIngestionState)
    : "idle";

const defaultState = (): HvscState => ({
  installedBaselineVersion: null,
  installedVersion: 0,
  ingestionState: "idle",
  lastUpdateCheckUtcMs: null,
  ingestionError: null,
  ingestionSummary: null,
  updates: {},
  librarySource: "real",
});

/**
 * Whether the archive is installed, which is the one question three unrelated callers ask of this
 * store. `installedVersion` is 0 until an import has completed, and the value is what every
 * "needs HVSC" gate turns on: a search entry's requirement, a Home tile's availability, and whether
 * song lengths can be discovered at all. It was written out separately in each of them.
 */
export const isHvscInstalled = (): boolean => loadHvscState().installedVersion > 0;

/** Demo Mode's release up to 1.0.3: release 84 with exactly 480 tunes. A real release 84 has tens of thousands. */
const LEGACY_DEMO_RELEASE = 84;
const LEGACY_DEMO_SONG_COUNT = 480;

// A state saved before the source was recorded counts as real, since only a simulated library is ever
// removed automatically, unless it is unmistakably the one Demo Mode installed: left as "real", that
// library would never be replaced by the real collection.
const resolveLibrarySource = (parsed: Partial<HvscState>): HvscLibrarySource => {
  if (parsed.librarySource === "demo" || parsed.librarySource === "real") return parsed.librarySource;
  const legacyDemo =
    parsed.installedVersion === LEGACY_DEMO_RELEASE && parsed.ingestionSummary?.totalSongs === LEGACY_DEMO_SONG_COUNT;
  return legacyDemo ? "demo" : "real";
};

export const loadHvscState = (): HvscState => {
  if (typeof localStorage === "undefined") return defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as Partial<HvscState> | null;
    if (!parsed) return defaultState();
    return {
      installedBaselineVersion: parsed.installedBaselineVersion ?? null,
      installedVersion: parsed.installedVersion ?? 0,
      ingestionState: toIngestionState(parsed.ingestionState),
      lastUpdateCheckUtcMs: parsed.lastUpdateCheckUtcMs ?? null,
      ingestionError: parsed.ingestionError ?? null,
      ingestionSummary: parsed.ingestionSummary ?? null,
      updates: parsed.updates ?? {},
      librarySource: resolveLibrarySource(parsed),
    };
  } catch (error) {
    addLog("warn", "Failed to load HVSC state from storage", {
      storageKey: STORAGE_KEY,
      error: (error as Error).message,
    });
    return defaultState();
  }
};

export const saveHvscState = (state: HvscState) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const updateHvscState = (partial: Partial<HvscState>) => {
  const current = loadHvscState();
  const next: HvscState = {
    ...current,
    ...partial,
    updates: partial.updates ?? current.updates,
  };
  saveHvscState(next);
  return next;
};

export const markUpdateApplied = (version: number, status: "success" | "failed", error?: string | null) => {
  const current = loadHvscState();
  const next: HvscState = {
    ...current,
    updates: {
      ...current.updates,
      [version]: { version, status, error: error ?? null },
    },
  };
  saveHvscState(next);
  return next;
};

export const isUpdateApplied = (version: number) => {
  const record = loadHvscState().updates[version];
  return record?.status === "success";
};
