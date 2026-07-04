/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useVolumePreviewInterval } from "@/pages/playFiles/hooks/useVolumePreviewInterval";
import { useVolumeOverride } from "@/pages/playFiles/hooks/useVolumeOverride";

type UsePlayFilesVolumeBindingsArgs = {
  isPlaying: boolean;
  isPaused: boolean;
  // HARD12-006: forward the resolved device id so useVolumeOverride can
  // persist and rehydrate the volume-session snapshot per device.
  resolvedDeviceId?: string | null;
};

export function usePlayFilesVolumeBindings({ isPlaying, isPaused, resolvedDeviceId }: UsePlayFilesVolumeBindingsArgs) {
  const volumeSliderPreviewIntervalMs = useVolumePreviewInterval();
  const volumeOverride = useVolumeOverride({
    isPlaying,
    isPaused,
    previewIntervalMs: volumeSliderPreviewIntervalMs,
    resolvedDeviceId,
  });

  return {
    volumeSliderPreviewIntervalMs,
    ...volumeOverride,
  };
}
