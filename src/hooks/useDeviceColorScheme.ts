/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { getC64API } from "@/lib/c64api";
import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { addLog } from "@/lib/logging";

const CONFIG_CATEGORY = "User Interface Settings";
const CONFIG_ITEM = "Color Scheme";

/**
 * The Ultimate's own `Color Scheme` setting, read on connect and on manual refresh only, never on
 * a poll (spec.md section 7.4, decision D4: the device's network stack is fragile under load).
 * This hook owns the connect trigger; Settings' "Refresh connection" calls the returned `refresh`.
 *
 * Returns null before the first successful read, on disconnect, or when the item is unreadable on
 * this firmware — "Match my device" then falls back to the compiled default and says so.
 */
export function useDeviceColorScheme() {
  const {
    status: { isConnected },
  } = useC64Connection();
  const [colorScheme, setColorScheme] = useState<string | null>(null);
  const wasConnectedRef = useRef(false);

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

  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      void refresh();
    }
    if (!isConnected) {
      setColorScheme(null);
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected, refresh]);

  return { colorScheme, refresh };
}
