/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { C64API } from "@/lib/c64api";
import { splitNormalizedDeviceHost } from "@/lib/c64api/hostConfig";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";
import { getPasswordForDevice } from "@/lib/secureStorage";
import { addLog } from "@/lib/logging";

/** Compare hosts by address alone, so `192.168.1.15:80` and `192.168.1.15` are the same machine. */
const hostKey = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return splitNormalizedDeviceHost(trimmed).host.toLowerCase();
};

/**
 * The saved-device password for a foreign sender, when the app knows that machine.
 *
 * The sender is an origin IP, so it matches a device saved by address directly and one saved by
 * hostname only through the address its last probe resolved. No match means no password.
 */
export const resolveForeignSenderPassword = async (host: string): Promise<string | null> => {
  const key = hostKey(host);
  if (!key) return null;
  try {
    const snapshot = getSavedDevicesSnapshot();
    const match = snapshot.devices.find(
      (device) =>
        hostKey(device.host) === key || hostKey(snapshot.summaries[device.id]?.lastResolvedAddress ?? null) === key,
    );
    if (!match?.hasPassword) return null;
    return await getPasswordForDevice(match.id);
  } catch (error) {
    addLog("debug", "Live View: could not look up a password for the uninvited sender", {
      service: "streams",
      host,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * Stop `name` at one uninvited machine, authenticated where possible and never raising a popup.
 *
 * A password-protected Ultimate answers an unauthenticated stop with 403, so the eviction achieves
 * nothing; and the dialog that 403 normally raises would name a machine the user never selected and,
 * if answered, re-verify the selected device's connection for an unrelated request.
 */
export const stopStreamAtForeignHost = async (host: string, name: "audio" | "video"): Promise<unknown> => {
  const password = await resolveForeignSenderPassword(host);
  return new C64API(undefined, password ?? undefined, host).stopStream(name, { suppressAuthChallenge: true });
};
