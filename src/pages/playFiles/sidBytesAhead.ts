/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getHvscDurationsByMd5Seconds } from "@/lib/hvsc";
import { addErrorLog, addLog } from "@/lib/logging";
import type { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { tryFetchUltimateSidBlob, type PlayRequest } from "@/lib/playback/playbackRouter";
import { buildRenderedTuneKey } from "@/lib/playback/renderedTuneCache";
import { toEngineTuneIndex } from "@/lib/playback/sidTuneIndex";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * Reading SID bytes before they are needed: a duration looked up by the tune's md5, and the openings of
 * the tracks either side of the one playing.
 */

/**
 * How much of an upcoming track to render ahead.
 *
 * Matched to the native buffer's depth, and that is the trick. The cached opening is poured into the
 * ring as fast as the ring will take it, so when it runs out and live rendering takes over, the ring
 * is holding roughly this much — exactly the margin the renderer needs to get ahead. Measured with a
 * six-second lead-in the ring fell to 0.44 s at the seam; matched to the ring it does not dip.
 *
 * Not more: output is 192 KB per second, so two warmed neighbours at this depth already cost a few
 * megabytes.
 */
export const LEAD_IN_SECONDS = 15;

/**
 * The md5-fallback duration lookup is per-subsong (HVSC durations are indexed
 * songNr - 1, mirroring the local songlengths backend), so a bare
 * `getHvscDurationByMd5Seconds` call silently returns subsong 1's length for
 * any other songNr. See HARD11-004 (related facet).
 */
export const resolveHvscDurationSecondsForSongNr = async (
  md5: string,
  songNr?: number | null,
): Promise<number | null> => {
  const durations = await getHvscDurationsByMd5Seconds(md5);
  if (!durations?.length) return null;
  const index = songNr && songNr > 0 ? songNr - 1 : 0;
  if (index < 0 || index >= durations.length) return null;
  return durations[index] ?? null;
};

export const resolveUltimateSidDurationByMd5 = async (path: string, songNr?: number | null): Promise<number | null> => {
  try {
    const blob = await tryFetchUltimateSidBlob(path);
    if (!blob) return null;
    const buffer = await blob.arrayBuffer();
    const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
    const md5 = await computeSidMd5(buffer);
    const seconds = await resolveHvscDurationSecondsForSongNr(md5, songNr);
    if (seconds === undefined || seconds === null) return null;
    return seconds * 1000;
  } catch (error) {
    addLog("debug", "Ultimate SID MD5 duration lookup failed", { path });
    addErrorLog("Ultimate SID MD5 duration lookup failed", {
      path,
      error: (error as Error).message,
    });
    return null;
  }
};

/**
 * Render the opening of the next and previous tracks, so skipping to either starts instantly.
 *
 * Only the opening — a few seconds is all that is needed to cover the gap before the buffer is
 * ahead of the speaker, and caching whole tunes costs 192 KB per second.
 *
 * Skipped for tracks whose bytes are not already to hand. Resolving those means going to the
 * network or the Ultimate, and doing that speculatively for tracks nobody has asked for would
 * spend the listener's bandwidth and the device's attention on a guess.
 */
export const warmNeighbouringLeadIns = async (
  playlist: PlaylistItem[],
  index: number,
  resolveHvscRuntimeRequest: (item: PlaylistItem) => Promise<{ request: PlayRequest } | null>,
  controller: LocalSidPlaybackController,
) => {
  for (const offset of [1, -1]) {
    const neighbour = playlist[index + offset];
    if (!neighbour) continue;
    // HVSC entries carry no bytes until they are played — resolving one reads from the on-device
    // library, which is local and cheap. Anything still without a file after that is coming over
    // the network, and is left alone rather than fetched on a guess.
    const resolved = neighbour.request.file
      ? neighbour.request
      : ((
          await resolveHvscRuntimeRequest(neighbour).catch((error: unknown) => {
            // Falling back to the unresolved request is right — this is speculative warming and
            // must never disturb what is playing — but a resolution that always fails means every
            // skip starts cold, which is a silent, permanent loss of the feature.
            addLog("debug", "Playback: could not resolve a neighbouring track for lead-in warming", {
              error: (error as Error)?.message ?? String(error),
            });
            return null;
          })
        )?.request ?? neighbour.request);
    const file = resolved.file;
    if (!file) continue;
    try {
      const bytes = await file.arrayBuffer();
      const tuneIndex = toEngineTuneIndex(resolved.songNr);
      controller.warmLeadIn(buildRenderedTuneKey(neighbour.id, tuneIndex), bytes, tuneIndex, LEAD_IN_SECONDS);
    } catch (error) {
      // A track that cannot be read now is simply not warmed; it will be read when it is played.
      addLog("debug", "Lead-in warm skipped", {
        service: "local-sid",
        item: neighbour.label,
        error: (error as Error)?.message ?? String(error),
      });
    }
  }
};
