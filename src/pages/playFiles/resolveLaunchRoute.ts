/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { loadLocalEngineEnabled, loadPlaybackEngine } from "@/lib/config/appSettings";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { preRouteEngine, type EngineFallbackNotice } from "@/lib/playback/playbackEngineRouting";
import { getRememberedUltimateSidBlob, tryFetchUltimateSidBlob, type PlayRequest } from "@/lib/playback/playbackRouter";
import { isC64UsableForSid, resolveLocalRoute, type RomDependencyAsk } from "@/pages/playFiles/resolveLocalRoute";
import type { PlaylistItem } from "@/pages/playFiles/types";

export interface LaunchRouteInput {
  item: PlaylistItem;
  request: PlayRequest;
  path: string;
  /** The Ultimate cannot be reached for this launch (see `playItem`). */
  deviceOutOfReach: boolean;
  /** Bytes the next-tune prefetcher already read from the Ultimate, if any. */
  takePrefetched: (itemId: string) => Blob | null;
  passOver: boolean;
  accepted: boolean;
  ask?: RomDependencyAsk;
  stillWanted: () => boolean;
  notify: (notice: EngineFallbackNotice) => void;
  onDeclined: () => void;
}

export interface LaunchRoute {
  routeToLocal: boolean;
  /** The request, with the bytes the phone needs when they had to be fetched for it. */
  request: PlayRequest;
  simulatedDevice: boolean;
}

/**
 * Where a playlist item plays: the C64, or this phone's own engine. Null when it does not play at all,
 * because the listener said Cancel to a song that needs the C64's ROMs, or something overtook it while
 * they were asked. Throws `RomDependentSongSkipped` when a playlist moving on passes over such a song.
 *
 * Nothing that is playing has been touched when this returns, so a null leaves it as it was.
 */
export const resolveLaunchRoute = async (input: LaunchRouteInput): Promise<LaunchRoute | null> => {
  const { item, path, deviceOutOfReach, notify } = input;
  let request = input.request;
  // Against the simulated device, or with no device at all, the on-device engine is the only
  // thing that can make a sound, so this runs whatever the local-engine flag says. The
  // flag still governs the choice against real hardware.
  const connectionState = getConnectionSnapshot().state;
  const simulatedDevice = connectionState === "DEMO_ACTIVE";
  const noDeviceConnected = connectionState === "OFFLINE_NO_DEMO";
  const noMachineForRoms = simulatedDevice || noDeviceConnected;
  if (!loadLocalEngineEnabled() && !noMachineForRoms) return { routeToLocal: false, request, simulatedDevice };
  const selection = preRouteEngine({
    category: item.category,
    engine: loadPlaybackEngine(),
    localSupported: LocalSidPlaybackController.isSupported(),
    simulatedDevice,
    noDeviceConnected,
  });
  // An Ultimate-hosted tune has no local blob, and the on-device engine needs the bytes.
  if (selection.route === "local" && !request.file && request.source === "ultimate") {
    // No try/catch: the fetch reports its own failures and answers with null.
    const remembered =
      noDeviceConnected || deviceOutOfReach ? getRememberedUltimateSidBlob(path, request.origin) : null;
    const blob = remembered ?? input.takePrefetched(item.id) ?? (await tryFetchUltimateSidBlob(path, request.origin));
    if (blob) {
      request = { ...request, file: new File([blob], path.split("/").pop() || "tune.sid") };
    } else if (!noMachineForRoms) {
      notify("sid-unreadable-on-c64");
    }
  }
  if (selection.route !== "local" || !request.file) {
    if (selection.notice && selection.route !== "local") notify(selection.notice);
    return { routeToLocal: false, request, simulatedDevice };
  }
  const routeToLocal = await resolveLocalRoute({
    file: request.file,
    songNr: request.songNr,
    label: item.label,
    selectionNotice: selection.notice,
    noMachineForRoms,
    c64Usable: isC64UsableForSid(deviceOutOfReach),
    passOver: input.passOver,
    accepted: input.accepted,
    ask: input.ask,
    stillWanted: input.stillWanted,
    notify,
    onDeclined: input.onDeclined,
  });
  return routeToLocal === null ? null : { routeToLocal, request, simulatedDevice };
};
