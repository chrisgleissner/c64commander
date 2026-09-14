/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import {
  isSimulatedDeviceOrigin,
  subscribeSimulatedDeviceContentRemoved,
} from "@/lib/connection/simulatedDeviceContent";
import { subscribeHvscDemoLibraryRemoved } from "@/lib/hvsc/hvscDemoLibraryCleanup";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * Leaving Demo Mode removes its HVSC library and the simulated device's files from storage. With the
 * Play page open, the playlist in memory drops them as well, or its next save would bring them back.
 */
export const useDemoPlaylistCleanup = (
  playlist: PlaylistItem[],
  removePlaylistItemsById: (ids: Set<string>) => void,
) => {
  const removeRef = useRef((_isDemoItem: (item: PlaylistItem) => boolean) => {});
  removeRef.current = (isDemoItem) =>
    removePlaylistItemsById(new Set(playlist.filter(isDemoItem).map((item) => item.id)));

  useEffect(
    () => subscribeHvscDemoLibraryRemoved(() => removeRef.current((item) => item.request.source === "hvsc")),
    [],
  );
  useEffect(
    () =>
      subscribeSimulatedDeviceContentRemoved(() =>
        removeRef.current((item) => isSimulatedDeviceOrigin(item.request.origin)),
      ),
    [],
  );
};
