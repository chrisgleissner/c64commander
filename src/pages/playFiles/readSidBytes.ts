/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { tryFetchUltimateSidBlob, type PlayRequest } from "@/lib/playback/playbackRouter";
import type { PlaylistItem } from "@/pages/playFiles/types";

export type ResolveHvscRuntimeRequest = (item: PlaylistItem) => Promise<{ request: PlayRequest } | null>;

/** A playlist SID's own bytes: read from the Ultimate for a file stored there, otherwise from the phone. */
export const readSidBytes = async (
  item: PlaylistItem,
  resolveHvscRuntimeRequest: ResolveHvscRuntimeRequest,
): Promise<ArrayBuffer | null> => {
  if (item.request.source === "ultimate") {
    return (await tryFetchUltimateSidBlob(item.path, item.request.origin))?.arrayBuffer() ?? null;
  }
  const file = item.request.file ?? (await resolveHvscRuntimeRequest(item))?.request.file;
  return file ? file.arrayBuffer() : null;
};
