/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import {
  loadHvscBrowseIndexSnapshot,
  normalizePath,
  saveHvscBrowseIndexSnapshot,
  updateHvscBrowseSong,
  type HvscBrowseIndexSnapshot,
} from "./hvscBrowseIndexStore";
import { deleteDataFileIfPresent, readDataFileText } from "./hvscFilesystem";
import { hydrateBrowseSongFromSidHeader } from "./hvscMetadataHydrator";

/** Virtual path to the song's raw SID header, base64-encoded, as the native ingest writes it. */
export type SidHeaderIndex = Record<string, string>;

/** Where the Android ingest writes the header index (`SID_HEADER_INDEX_PATH` in `HvscSidHeaderIndex.kt`). */
export const INGESTED_SID_HEADER_INDEX_PATH = "hvsc/index/ingested-sid-headers.json";

const SONGS_PER_CHUNK = 500;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Hydrates every indexed song the header index names, exactly as metadata hydration would after
 * reading the whole file. Songs the browse index does not list are left out, as hydration only ever
 * visits listed songs.
 */
export const applySidHeaderIndex = async (snapshot: HvscBrowseIndexSnapshot, headers: SidHeaderIndex) => {
  let hydrated = 0;
  let failed = 0;
  let notIndexed = 0;
  let visited = 0;
  for (const [virtualPath, headerBase64] of Object.entries(headers)) {
    visited += 1;
    if (visited % SONGS_PER_CHUNK === 0) await yieldToUi();
    if (!snapshot.songs[normalizePath(virtualPath)]) {
      notIndexed += 1;
      continue;
    }
    try {
      hydrateBrowseSongFromSidHeader(snapshot, virtualPath, base64ToUint8(headerBase64));
      hydrated += 1;
    } catch (error) {
      failed += 1;
      updateHvscBrowseSong(snapshot, virtualPath, { metadataStatus: "error" });
      addLog("warn", "HVSC metadata hydration failed for song", {
        virtualPath,
        source: "ingested SID header",
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
    }
  }
  return { hydrated, failed, notIndexed };
};

/**
 * Takes the header metadata of the songs an Android ingest just wrote from the index it left beside
 * the library, so they reach the browse index hydrated and metadata hydration has nothing to re-read.
 * Any failure leaves those songs to metadata hydration, which reads each one from its file instead. The index is left on disk for {@link discardIngestedSidHeaderIndex}.
 */
export const applyIngestedSidHeaders = async (sidHeaderIndexPath: string) => {
  try {
    const text = await readDataFileText(sidHeaderIndexPath);
    if (text === null) {
      addLog("warn", "HVSC SID header index missing; metadata hydration will read each song", {
        sidHeaderIndexPath,
      });
      return;
    }
    const snapshot = await loadHvscBrowseIndexSnapshot();
    if (snapshot === null) {
      addLog("warn", "HVSC SID header index not applied: no browse index; metadata hydration will read each song", {
        sidHeaderIndexPath,
      });
      return;
    }
    const outcome = await applySidHeaderIndex(snapshot, JSON.parse(text) as SidHeaderIndex);
    await saveHvscBrowseIndexSnapshot(snapshot, { foldersUnchanged: true });
    addLog("info", "HVSC song metadata taken from the ingested SID headers", { sidHeaderIndexPath, ...outcome });
  } catch (error) {
    addLog("warn", "HVSC SID header index could not be applied; metadata hydration will read each song", {
      sidHeaderIndexPath,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

/** Deletes the header index, a 13 to 14 MB file for a full library, whether or not it was applied. */
export const discardIngestedSidHeaderIndex = async (sidHeaderIndexPath = INGESTED_SID_HEADER_INDEX_PATH) => {
  try {
    await deleteDataFileIfPresent(sidHeaderIndexPath);
  } catch (error) {
    addLog("warn", "Failed to delete the HVSC SID header index", {
      sidHeaderIndexPath,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};
