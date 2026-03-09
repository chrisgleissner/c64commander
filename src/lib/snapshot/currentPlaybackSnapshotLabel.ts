/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import { PLAYBACK_SESSION_KEY } from "@/pages/playFiles/playFilesUtils";

export const getCurrentPlaybackSnapshotLabel = (): string | undefined => {
  if (typeof sessionStorage === "undefined") return undefined;
  const raw = sessionStorage.getItem(PLAYBACK_SESSION_KEY);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const label = (parsed as { currentItemLabel?: unknown }).currentItemLabel;
    if (typeof label !== "string") return undefined;
    const trimmed = label.trim();
    return trimmed || undefined;
  } catch (error) {
    addErrorLog("Failed to read current playback snapshot label", {
      error: (error as Error).message,
    });
    return undefined;
  }
};
