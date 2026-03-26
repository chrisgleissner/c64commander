/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import {
  APP_SETTINGS_KEYS,
  loadArchiveClientIdOverride,
  loadArchiveHostOverride,
  loadArchiveUserAgentOverride,
  loadCommoserveEnabled,
} from "@/lib/config/appSettings";

type ArchiveClientSettingsState = {
  commoserveEnabled: boolean;
  archiveHostOverride: string;
  archiveClientIdOverride: string;
  archiveUserAgentOverride: string;
};

const ARCHIVE_SETTINGS_KEYS = new Set<string>([
  APP_SETTINGS_KEYS.COMMOSERVE_ENABLED_KEY,
  APP_SETTINGS_KEYS.ARCHIVE_HOST_OVERRIDE_KEY,
  APP_SETTINGS_KEYS.ARCHIVE_CLIENT_ID_OVERRIDE_KEY,
  APP_SETTINGS_KEYS.ARCHIVE_USER_AGENT_OVERRIDE_KEY,
]);

const loadArchiveClientSettingsState = (): ArchiveClientSettingsState => ({
  commoserveEnabled: loadCommoserveEnabled(),
  archiveHostOverride: loadArchiveHostOverride(),
  archiveClientIdOverride: loadArchiveClientIdOverride(),
  archiveUserAgentOverride: loadArchiveUserAgentOverride(),
});

export function useArchiveClientSettings(): ArchiveClientSettingsState & {
  archiveConfig: ArchiveClientConfigInput;
} {
  const [settings, setSettings] = useState(loadArchiveClientSettingsState);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined;
      if (!detail?.key || !ARCHIVE_SETTINGS_KEYS.has(detail.key)) return;
      setSettings(loadArchiveClientSettingsState());
    };

    window.addEventListener("c64u-app-settings-updated", handler as EventListener);
    return () => window.removeEventListener("c64u-app-settings-updated", handler as EventListener);
  }, []);

  const archiveConfig = useMemo(
    () =>
      buildDefaultArchiveClientConfig({
        enabled: settings.commoserveEnabled,
        hostOverride: settings.archiveHostOverride,
        clientIdOverride: settings.archiveClientIdOverride,
        userAgentOverride: settings.archiveUserAgentOverride,
      }),
    [
      settings.archiveClientIdOverride,
      settings.archiveHostOverride,
      settings.archiveUserAgentOverride,
      settings.commoserveEnabled,
    ],
  );

  return {
    ...settings,
    archiveConfig,
  };
}
