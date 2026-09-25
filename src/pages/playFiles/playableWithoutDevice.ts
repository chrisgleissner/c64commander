/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getCachedArchivePlayback } from "@/lib/archive/archivePlaybackCache";
import { getConnectionSnapshot, isSimulatedDeviceTarget } from "@/lib/connection/connectionManager";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { getRememberedUltimateSidBlob } from "@/lib/playback/playbackRouter";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * Away from the device, a playlist carries on with the tracks the phone can play itself.
 *
 * Demo Mode's device is simulated inside this process and served over loopback, so a phone with its
 * radios off is not away from it — and that is the state every Demo Mode session on a phone with no
 * connection starts in. Without this exclusion, pressing play on a demo tune ended at "Device not
 * connected. Check connection settings." and the demo played nothing at all.
 */
export const isDeviceOutOfReach = () =>
  !isSimulatedDeviceTarget() && (isNetworkKnownOffline() || getConnectionSnapshot().state === "OFFLINE_NO_DEMO");

/** Whether a track can play on the phone while the Ultimate is out of reach. */
export const canPlayWithoutDevice = (item: PlaylistItem | undefined): boolean => {
  if (item?.category !== "sid" || !LocalSidPlaybackController.isSupported()) return false;
  if (item.request.source === "ultimate") return getRememberedUltimateSidBlob(item.path, item.request.origin) !== null;
  if (item.request.source !== "commoserve" || item.request.file || !isNetworkKnownOffline()) return true;
  return Boolean(item.archiveRef && getCachedArchivePlayback(item.archiveRef));
};

/** Starting at `index`, the first track in playing order that can play without the device, or null. */
export const firstPlayableWithoutDevice = (
  playlist: PlaylistItem[],
  index: number | null,
  following: (from: number) => number | null,
): number | null => {
  let candidate = index;
  for (let hops = 0; candidate !== null && hops < playlist.length; hops += 1) {
    if (canPlayWithoutDevice(playlist[candidate])) return candidate;
    candidate = following(candidate);
  }
  return null;
};
