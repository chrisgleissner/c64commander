/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { C64API, getC64API, getC64APIConfigSnapshot } from "@/lib/c64api";
import { buildBaseUrlFromDeviceHost } from "@/lib/c64api/hostConfig";
import { addLog } from "@/lib/logging";

const IDENTITY_TIMEOUT_MS = 3000;

type FetchUniqueId = (host: string) => Promise<string | null>;

const fetchUniqueIdOverRest: FetchUniqueId = async (host) => {
  const selected = getC64API();
  const api =
    host === selected.getDeviceHost()
      ? selected
      : new C64API(buildBaseUrlFromDeviceHost(host), getC64APIConfigSnapshot().password, host);
  const info = await api.getInfo({ timeoutMs: IDENTITY_TIMEOUT_MS });
  return info?.unique_id?.trim() || null;
};

/**
 * Whether a stream sender that the address filter refused is the selected device itself.
 *
 * An Ultimate on both Ethernet and Wi-Fi answers REST on one address and streams from the other, so
 * the filter, which compares addresses, drops the device's own audio and video. The device's unique
 * id tells the two cases apart: the same id on both addresses is the same machine.
 */
export const isSelectedDeviceSender = async (
  source: string,
  selectedHost: string,
  fetchUniqueId: FetchUniqueId = fetchUniqueIdOverRest,
): Promise<boolean> => {
  try {
    const [sourceId, selectedId] = await Promise.all([fetchUniqueId(source), fetchUniqueId(selectedHost)]);
    return sourceId !== null && sourceId === selectedId;
  } catch (error) {
    addLog("warn", "Live View: could not tell whether a refused stream sender is the selected device", {
      service: "streams",
      source,
      selectedHost,
      error: (error as Error).message,
    });
    return false;
  }
};
