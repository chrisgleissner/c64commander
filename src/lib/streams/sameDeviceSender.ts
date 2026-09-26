/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { C64API, getC64API } from "@/lib/c64api";
import { buildBaseUrlFromDeviceHost } from "@/lib/c64api/hostConfig";
import { StreamUdp } from "@/lib/native/streamUdp";
import { addLog } from "@/lib/logging";

const IDENTITY_TIMEOUT_MS = 3000;
const IDENT_TIMEOUT_MS = 1500;

type FetchUniqueId = (host: string) => Promise<string | null>;

export interface SenderIdentityDeps {
  /** The sender's id, asked without the selected device's password: the sender may be another machine. */
  senderUniqueId: FetchUniqueId;
  selectedUniqueId: FetchUniqueId;
}

const trimmedId = (value: string | null | undefined): string | null => value?.trim() || null;

const uniqueIdWithoutPassword: FetchUniqueId = async (host) => {
  if (Capacitor.isPluginAvailable("StreamUdp")) {
    const { uniqueId } = await StreamUdp.identify({ host, timeoutMs: IDENT_TIMEOUT_MS });
    if (trimmedId(uniqueId)) return trimmedId(uniqueId);
  }
  const info = await new C64API(buildBaseUrlFromDeviceHost(host), undefined, host).getInfo({
    timeoutMs: IDENTITY_TIMEOUT_MS,
    __c64uIntent: "system",
  });
  return trimmedId(info?.unique_id);
};

const selectedDeviceUniqueId: FetchUniqueId = async () => {
  const info = await getC64API().getInfo({ timeoutMs: IDENTITY_TIMEOUT_MS, __c64uIntent: "system" });
  return trimmedId(info?.unique_id);
};

const defaultDeps: SenderIdentityDeps = {
  senderUniqueId: uniqueIdWithoutPassword,
  selectedUniqueId: selectedDeviceUniqueId,
};

/**
 * Whether a stream sender that the address filter refused is the selected device itself.
 *
 * An Ultimate on both Ethernet and Wi-Fi answers REST on either address but streams only from its
 * Ethernet address, so a filter keyed to the Wi-Fi address drops the device's own audio and video.
 * The same unique id on both addresses is the same machine.
 */
export const isSelectedDeviceSender = async (
  source: string,
  selectedHost: string,
  deps: SenderIdentityDeps = defaultDeps,
): Promise<boolean> => {
  try {
    const [sourceId, selectedId] = await Promise.all([
      deps.senderUniqueId(source),
      deps.selectedUniqueId(selectedHost),
    ]);
    return sourceId !== null && sourceId === selectedId;
  } catch (error) {
    addLog("warn", "Live View: could not tell whether a stream sender is the selected device", {
      service: "streams",
      source,
      selectedHost,
      error: (error as Error).message,
    });
    return false;
  }
};
