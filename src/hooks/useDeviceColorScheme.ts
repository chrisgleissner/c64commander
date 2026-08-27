/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState } from "react";
import { useConnectionRoutingEpoch } from "@/hooks/useC64Connection";
import { useConnectionState } from "@/hooks/useConnectionState";
import { getC64API } from "@/lib/c64api";
import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { addLog } from "@/lib/logging";

const CONFIG_CATEGORY = "User Interface Settings";
const CONFIG_ITEM = "Color Scheme";

/**
 * The Ultimate's own `Color Scheme` setting, read when the connection settles and on manual
 * refresh only, never on a poll (spec.md section 7.4, decision D4: the device's network stack is
 * fragile under load). Settings' "Refresh connection" calls the returned `refresh`.
 *
 * Returns null before the first successful read, off a real device, or when the item is unreadable
 * on this firmware — "Match my device" then falls back to the compiled default and says so.
 */
export function useDeviceColorScheme() {
  const connection = useConnectionState();
  // REAL_CONNECTED only: a demo device has no Color Scheme to match, so asking is meaningless.
  const isRealConnected = connection.state === "REAL_CONNECTED";
  const routingEpoch = useConnectionRoutingEpoch();
  const [colorScheme, setColorScheme] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const api = getC64API();
      const response = await api.getConfigItem(CONFIG_CATEGORY, CONFIG_ITEM, { __c64uIntent: "background" });
      const categoryBlock = response[CONFIG_CATEGORY];
      const itemRaw =
        categoryBlock && typeof categoryBlock === "object"
          ? (categoryBlock as Record<string, unknown>)[CONFIG_ITEM]
          : undefined;
      const value = extractConfigValue(itemRaw);
      setColorScheme(typeof value === "string" && value ? value : null);
    } catch (error) {
      addLog("debug", "Failed to read the device Color Scheme for Match my device", {
        error: error instanceof Error ? error.message : String(error),
      });
      setColorScheme(null);
    }
  }, []);

  /*
   * Keyed on the routing epoch, not on a one-shot connect edge. Connecting calls
   * applyC64APIRuntimeConfig immediately after transitionTo("REAL_CONNECTED"), which bumps the
   * request generation and aborts every read started on that edge — including this one, which then
   * never retried and left "Match my device" permanently unresolved. The epoch changes on the same
   * connection-change event, so this re-reads once against the settled host.
   */
  useEffect(() => {
    if (!isRealConnected) {
      setColorScheme(null);
      return;
    }
    void refresh();
  }, [isRealConnected, routingEpoch, refresh]);

  return { colorScheme, refresh };
}
