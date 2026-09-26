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

/** What identifies a machine: `unique_id` alone is user-editable, so the hostname must match too. */
export interface MachineIdentity {
  uniqueId: string | null;
  hostname: string | null;
}

type FetchIdentity = (host: string) => Promise<MachineIdentity>;

export interface SenderIdentityDeps {
  /** The sender's identity, asked without the selected device's password: the sender may be another machine. */
  senderIdentity: FetchIdentity;
  selectedIdentity: FetchIdentity;
}

/** `unknown` when either side cannot be identified; only `different` may justify stopping a sender. */
export type SenderVerdict = "same" | "different" | "unknown";

const normalized = (value: string | null | undefined): string | null => value?.trim().toLowerCase() || null;

const identityOf = (info: { unique_id?: string | null; hostname?: string | null } | null | undefined) => ({
  uniqueId: normalized(info?.unique_id),
  hostname: normalized(info?.hostname),
});

const identityWithoutPassword: FetchIdentity = async (host) => {
  if (Capacitor.isPluginAvailable("StreamUdp")) {
    const reply = await StreamUdp.identify({ host, timeoutMs: IDENT_TIMEOUT_MS });
    const identity = identityOf({ unique_id: reply.uniqueId, hostname: reply.hostname });
    if (identity.uniqueId) return identity;
  }
  const info = await new C64API(buildBaseUrlFromDeviceHost(host), undefined, host).getInfo({
    timeoutMs: IDENTITY_TIMEOUT_MS,
    __c64uIntent: "system",
  });
  return identityOf(info);
};

const selectedDeviceIdentity: FetchIdentity = async () =>
  identityOf(await getC64API().getInfo({ timeoutMs: IDENTITY_TIMEOUT_MS, __c64uIntent: "system" }));

const defaultDeps: SenderIdentityDeps = {
  senderIdentity: identityWithoutPassword,
  selectedIdentity: selectedDeviceIdentity,
};

export const compareMachineIdentities = (a: MachineIdentity, b: MachineIdentity): SenderVerdict => {
  if (!a.uniqueId || !b.uniqueId || !a.hostname || !b.hostname) return "unknown";
  return a.uniqueId === b.uniqueId && a.hostname === b.hostname ? "same" : "different";
};

/**
 * Whether a stream sender is the selected device on another of its network addresses.
 *
 * An Ultimate on both Ethernet and Wi-Fi answers REST on either address but streams only from its
 * Ethernet address, so a filter keyed to the Wi-Fi address drops the device's own audio and video.
 */
export const judgeStreamSender = async (
  source: string,
  selectedHost: string,
  deps: SenderIdentityDeps = defaultDeps,
): Promise<SenderVerdict> => {
  try {
    const [sender, selected] = await Promise.all([deps.senderIdentity(source), deps.selectedIdentity(selectedHost)]);
    return compareMachineIdentities(sender, selected);
  } catch (error) {
    addLog("warn", "Live View: could not tell whether a stream sender is the selected device", {
      service: "streams",
      source,
      selectedHost,
      error: (error as Error).message,
    });
    return "unknown";
  }
};
