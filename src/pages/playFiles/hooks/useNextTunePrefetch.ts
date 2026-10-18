/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { getDeviceStateSnapshot } from "@/lib/deviceInteraction/deviceStateStore";
import { getDiagnosticsActivitySnapshot } from "@/lib/diagnostics/diagnosticsActivity";
import type { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { tryFetchUltimateSidBlob, type PlayRequest } from "@/lib/playback/playbackRouter";
import { NextTunePrefetcher } from "@/pages/playFiles/nextTunePrefetch";
import { warmNeighbouringLeadIns } from "@/pages/playFiles/sidBytesAhead";
import type { PlaylistItem } from "@/pages/playFiles/types";

export const DEVICE_ANSWERED_RECENTLY_MS = 5 * 60_000;

export const isDeviceReadyForPrefetch = (): boolean => {
  if (getConnectionSnapshot().state !== "REAL_CONNECTED") return false;
  const device = getDeviceStateSnapshot();
  const activity = getDiagnosticsActivitySnapshot();
  const answeredRecently =
    device.lastSuccessAtMs !== null && Date.now() - device.lastSuccessAtMs < DEVICE_ANSWERED_RECENTLY_MS;
  const noRequestInFlight = device.busyCount === 0 && activity.restInFlight === 0 && activity.ftpInFlight === 0;
  return device.state === "READY" && answeredRecently && noRequestInFlight;
};

interface NextTunePrefetchInput {
  playlistRef: MutableRefObject<PlaylistItem[]>;
  currentIndexRef: MutableRefObject<number>;
  resolveHvscRuntimeRequest: (item: PlaylistItem) => Promise<{ request: PlayRequest } | null>;
  getLocalSidPlayback: () => LocalSidPlaybackController;
}

/**
 * Owns the prefetcher of the next tune's bytes and the warming of the neighbouring lead-ins that uses
 * them. Everything is cancelled when the page goes away.
 */
export const useNextTunePrefetch = (input: NextTunePrefetchInput) => {
  const inputRef = useRef(input);
  inputRef.current = input;
  const ref = useRef<{ prefetcher: NextTunePrefetcher; warmNeighbours: () => Promise<void> } | null>(null);
  if (!ref.current) {
    const warmNeighbours = () => {
      const { playlistRef, currentIndexRef, resolveHvscRuntimeRequest, getLocalSidPlayback } = inputRef.current;
      return warmNeighbouringLeadIns(
        playlistRef.current,
        currentIndexRef.current,
        resolveHvscRuntimeRequest,
        getLocalSidPlayback(),
        (item) => ref.current?.prefetcher.peek(item.id) ?? null,
      );
    };
    const prefetcher = new NextTunePrefetcher({
      fetchBlob: (item, signal) =>
        tryFetchUltimateSidBlob(item.path, item.request.origin, { intent: "background", signal }),
      isDeviceReady: isDeviceReadyForPrefetch,
      onStored: () => void warmNeighbours(),
    });
    ref.current = { prefetcher, warmNeighbours };
  }
  const current = ref.current;
  useEffect(() => () => current.prefetcher.clear(), [current]);
  return current;
};
