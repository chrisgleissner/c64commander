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

/** Long enough for 3.7 MB on a slow phone connection; a stalled download must still end. */
export const STIL_FETCH_TIMEOUT_MS = 60_000;
/** After a failed download, lookups that merely want notes wait this long before trying again. */
export const STIL_FETCH_RETRY_AFTER_MS = 5 * 60_000;

const fetchStilBytes = async (release: number, signal?: AbortSignal): Promise<Uint8Array | null> => {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), STIL_FETCH_TIMEOUT_MS);
  const forwardAbort = () => deadline.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    for (const url of buildStilUrls(release)) {
      try {
        const response = await fetch(url, { cache: "no-store", signal: deadline.signal });
        if (!response.ok) {
          addLog("debug", "STIL not available at URL", { url, status: response.status });
          continue;
        }
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (signal?.aborted) throw error;
        if (deadline.signal.aborted) {
          addLog("warn", "STIL download timed out", { url, timeoutMs: STIL_FETCH_TIMEOUT_MS });
          return null;
        }
        addLog("debug", "STIL fetch failed", { url, error: (error as Error).message });
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
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
let lastFailedFetchAt: number | null = null;

/**
 * The release STIL has to be downloaded for, or null when nothing should be downloaded.
 *
 * Nothing is downloaded without a library, or for Demo Mode's library: its tunes are invented and
 * the published notes describe none of them.
 */
const releaseToFetch = async (): Promise<number | null> => {
  if (hasMockedStil()) return null;
  const state = loadHvscState();
  if (state.installedVersion <= 0 || state.librarySource === "demo") return null;
  const manifest = await readStilManifest();
  return manifest && manifest.release >= state.installedVersion ? null : state.installedVersion;
};

/** Whether {@link ensureStilReady} would download, so a caller can say it is waiting on the network. */
export const isStilFetchNeeded = async (): Promise<boolean> => (await releaseToFetch()) !== null;

/** Why STIL is not available, for a caller that has to tell the listener. */
export const stilUnavailableReason = (): "no-library" | "demo-library" | "not-downloaded" => {
  const state = loadHvscState();
  if (state.installedVersion <= 0) return "no-library";
  return state.librarySource === "demo" ? "demo-library" : "not-downloaded";
};

/**
 * Make sure STIL is on disk, downloading it only if it is not.
 *
 * Coalesced and idempotent: several tunes asking at once produce one fetch, and a store that is
 * already current returns without touching the network. After a failed download, callers wait
 * {@link STIL_FETCH_RETRY_AFTER_MS} before the next attempt unless they pass `retryNow`, which is for
 * a listener's explicit request. Returns whether anything is available to look up afterwards.
 */
export const ensureStilReady = async (options?: { signal?: AbortSignal; retryNow?: boolean }): Promise<boolean> => {
  // A test supplying STIL directly has already answered this; downloading over the top of it would
  // be both wrong and impossible offline. Deliberately not `isStilInstalled()`, which is also true
  // of a stored copy that is older than the installed release — that one has to be refreshed, and
  // short-circuiting on it meant a library updated to a new release kept the previous release's
  // notes for ever.
  if (hasMockedStil()) return true;
  const release = await releaseToFetch();
  if (release === null) return isStilInstalled();
  const backingOff = lastFailedFetchAt !== null && Date.now() - lastFailedFetchAt < STIL_FETCH_RETRY_AFTER_MS;
  if (backingOff && !options?.retryNow && !ensureInFlight) return isStilInstalled();

  ensureInFlight ??= (async () => {
    try {
      const bytes = await fetchStilBytes(release, options?.signal);
      if (!bytes) {
        lastFailedFetchAt = Date.now();
        addLog("warn", "STIL could not be fetched", { release });
        // An older stored copy is still better than nothing.
        return isStilInstalled();
      }
      const count = await ingestStilText(decodeStilText(bytes), release);
      if (count === 0) {
        // A captive portal answers with a page that parses to nothing; that is a failed download too.
        lastFailedFetchAt = Date.now();
        addLog("warn", "STIL download held no entries", { release, bytes: bytes.length });
        return isStilInstalled();
      }
      lastFailedFetchAt = null;
      addLog("info", "STIL downloaded", { release, entries: count, bytes: bytes.length });
      return true;
    } catch (error) {
      lastFailedFetchAt = Date.now();
      addErrorLog("STIL preparation failed", { release, error: (error as Error).message });
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
  lastFailedFetchAt = null;
};
