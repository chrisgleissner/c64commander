/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { APP_SETTINGS_KEYS, loadStreamVideoBadges } from "@/lib/config/appSettings";

/**
 * Whether the "PAL 50 fps" badge is drawn over the C64 picture. Both the Home preview and the
 * immersive Remote Input view read it, and a viewer turning it off mid-stream must see the
 * picture clear immediately, so this follows the shared settings event rather than the value
 * read once at mount.
 */
export const useStreamVideoBadges = () => {
  const [enabled, setEnabled] = useState(loadStreamVideoBadges);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      if (detail?.key !== APP_SETTINGS_KEYS.STREAM_VIDEO_BADGES_KEY) return;
      setEnabled(typeof detail.value === "boolean" ? detail.value : loadStreamVideoBadges());
    };
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);

  return enabled;
};
