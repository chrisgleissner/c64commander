/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Getting hold of STIL.
 *
 * Two ways in, because there are two situations.
 *
 * A library installed from now on gets STIL for free: the document is already inside the archive
 * being extracted, so the ingestion hands its bytes over and nothing is downloaded. A library
 * installed before this existed has no STIL on disk and no reason to re-download a multi-hundred-
 * megabyte archive to get it, so the document is fetched on its own. It is 3.7 MB — a fraction of a
 * percent of the archive it belongs to — and it is fetched once.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { loadHvscState } from "./hvscStateStore";
import { getHvscBaseUrl } from "./hvscReleaseService";
import { decodeStilText } from "./stilParser";
import { hasMockedStil, ingestStilText, isStilInstalled, readStilManifest } from "./stilStore";

/**
 * Releases sit in a directory named after their version, alongside the archives themselves:
 * `HVSC_84-all-of-them.7z` next to `C64Music.84/DOCUMENTS/STIL.txt`. The unversioned `C64Music/`
 * is the fallback for a mirror that only publishes the current release.
 */
export const buildStilUrls = (release: number, baseUrl?: string): string[] => {
  const base = baseUrl ?? getHvscBaseUrl();
  const urls = release > 0 ? [`${base}C64Music.${release}/DOCUMENTS/STIL.txt`] : [];
  urls.push(`${base}C64Music/DOCUMENTS/STIL.txt`);
  return urls;
};

const fetchStilBytes = async (release: number, signal?: AbortSignal): Promise<Uint8Array | null> => {
  for (const url of buildStilUrls(release)) {
    try {
      const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
      if (!response.ok) {
        addLog("debug", "STIL not available at URL", { url, status: response.status });
        continue;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      addLog("debug", "STIL fetch failed", { url, error: (error as Error).message });
    }
  }
  return null;
};

/** Store STIL from bytes already in hand — the ingestion path, where nothing is downloaded. */
export const storeStilFromArchive = async (bytes: Uint8Array, release: number): Promise<number> => {
  try {
    const count = await ingestStilText(decodeStilText(bytes), release);
    addLog("info", "STIL taken from the archive", { release, entries: count });
    return count;
  } catch (error) {
    // STIL is an enrichment. Failing to store it must never fail the library install.
    addErrorLog("Failed to store STIL from archive", { release, error: (error as Error).message });
    return 0;
  }
};

let ensureInFlight: Promise<boolean> | null = null;

/**
 * Make sure STIL is on disk, downloading it only if it is not.
 *
 * Coalesced and idempotent: several tunes asking at once produce one fetch, and a store that is
 * already current returns without touching the network. Returns whether anything is available to
 * look up afterwards.
 */
export const ensureStilReady = async (options?: { signal?: AbortSignal }): Promise<boolean> => {
  // A test supplying STIL directly has already answered this; downloading over the top of it would
  // be both wrong and impossible offline. Deliberately not `isStilInstalled()`, which is also true
  // of a stored copy that is older than the installed release — that one has to be refreshed, and
  // short-circuiting on it meant a library updated to a new release kept the previous release's
  // notes for ever.
  if (hasMockedStil()) return true;
  const state = loadHvscState();
  if (state.installedVersion <= 0) return false;

  const manifest = await readStilManifest();
  if (manifest && manifest.release >= state.installedVersion) return true;

  ensureInFlight ??= (async () => {
    try {
      const bytes = await fetchStilBytes(state.installedVersion, options?.signal);
      if (!bytes) {
        addLog("warn", "STIL could not be fetched", { release: state.installedVersion });
        // An older stored copy is still better than nothing.
        return isStilInstalled();
      }
      const count = await ingestStilText(decodeStilText(bytes), state.installedVersion);
      addLog("info", "STIL downloaded", {
        release: state.installedVersion,
        entries: count,
        bytes: bytes.length,
      });
      return count > 0;
    } catch (error) {
      addErrorLog("STIL preparation failed", { error: (error as Error).message });
      return isStilInstalled();
    } finally {
      ensureInFlight = null;
    }
  })();

  return ensureInFlight;
};

/** Test seam. */
export const __resetStilServiceForTest = () => {
  ensureInFlight = null;
};
