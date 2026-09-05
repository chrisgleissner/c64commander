/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";
import { useConnectionState } from "@/hooks/useConnectionState";
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
  // Demo Mode redirects the archive to this device's own loopback server, and that is not a
  // setting, so nothing in `settings` changes when it starts or stops. Without the connection
  // state in the dependencies below, a config built before Demo Mode was entered keeps pointing
  // at the internet for the rest of the session — which on an offline phone is no archive at all.
  const { state: connectionState } = useConnectionState();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined;
      if (!detail?.key || !ARCHIVE_SETTINGS_KEYS.has(detail.key)) return;
      setSettings(loadArchiveClientSettingsState());
    };

    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
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
      connectionState,
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
