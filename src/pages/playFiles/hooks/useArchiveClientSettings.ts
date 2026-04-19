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
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import {
  APP_SETTINGS_KEYS,
  loadArchiveClientIdOverride,
  loadArchiveHostOverride,
  loadArchiveUserAgentOverride,
} from "@/lib/config/appSettings";

type ArchiveClientSettingsState = {
  archiveHostOverride: string;
  archiveClientIdOverride: string;
  archiveUserAgentOverride: string;
};

const ARCHIVE_SETTINGS_KEYS = new Set<string>([
  APP_SETTINGS_KEYS.ARCHIVE_HOST_OVERRIDE_KEY,
  APP_SETTINGS_KEYS.ARCHIVE_CLIENT_ID_OVERRIDE_KEY,
  APP_SETTINGS_KEYS.ARCHIVE_USER_AGENT_OVERRIDE_KEY,
]);

const loadArchiveClientSettingsState = (): ArchiveClientSettingsState => ({
  archiveHostOverride: loadArchiveHostOverride(),
  archiveClientIdOverride: loadArchiveClientIdOverride(),
  archiveUserAgentOverride: loadArchiveUserAgentOverride(),
});

export function useArchiveClientSettings(): ArchiveClientSettingsState & {
  commoserveEnabled: boolean;
  archiveConfig: ArchiveClientConfigInput;
} {
  const { value: commoserveEnabled } = useFeatureFlag("commoserve_enabled");
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
        enabled: commoserveEnabled,
        hostOverride: settings.archiveHostOverride,
        clientIdOverride: settings.archiveClientIdOverride,
        userAgentOverride: settings.archiveUserAgentOverride,
      }),
    [
      commoserveEnabled,
      settings.archiveClientIdOverride,
      settings.archiveHostOverride,
      settings.archiveUserAgentOverride,
    ],
  );

  return {
    commoserveEnabled,
    ...settings,
    archiveConfig,
  };
}
