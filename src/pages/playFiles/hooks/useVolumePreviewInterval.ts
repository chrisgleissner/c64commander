/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { APP_SETTINGS_KEYS, loadVolumeSliderPreviewIntervalMs } from "@/lib/config/appSettings";

export function useVolumePreviewInterval() {
  const [previewIntervalMs, setPreviewIntervalMs] = useState(loadVolumeSliderPreviewIntervalMs());

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key !== APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY) return;
      setPreviewIntervalMs(loadVolumeSliderPreviewIntervalMs());
    };

    window.addEventListener("c64u-app-settings-updated", handler as EventListener);
    return () => window.removeEventListener("c64u-app-settings-updated", handler as EventListener);
  }, []);

  return previewIntervalMs;
}
