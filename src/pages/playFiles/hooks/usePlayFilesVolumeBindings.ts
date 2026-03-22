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
};

export function usePlayFilesVolumeBindings({ isPlaying, isPaused }: UsePlayFilesVolumeBindingsArgs) {
  const volumeSliderPreviewIntervalMs = useVolumePreviewInterval();
  const volumeOverride = useVolumeOverride({
    isPlaying,
    isPaused,
    previewIntervalMs: volumeSliderPreviewIntervalMs,
  });

  return {
    volumeSliderPreviewIntervalMs,
    ...volumeOverride,
  };
}
