/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SavedDevicesSnapshot } from "./store";

/** What an Ultimate reports about itself in `/v1/info`: its unique id and its hostname. */
export type MachineIdentity = { uniqueId?: string | null; hostname?: string | null };

const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

/**
 * A key naming one physical Ultimate, or null when its identity is unknown. The unique id alone is not enough: the
 * user can set it, so two devices may share one. The default hostname carries a MAC-derived suffix, so requiring
 * both to match means an accidental merge needs a duplicated custom unique id and a duplicated hostname.
 */
export const machineIdentityKey = ({ uniqueId, hostname }: MachineIdentity): string | null => {
  const id = normalize(uniqueId);
  const name = normalize(hostname);
  return id && name ? JSON.stringify([id, name]) : null;
};

/** True only when both identities are known and name the same machine; unknown means "cannot tell". */
export const isSameMachine = (left: MachineIdentity, right: MachineIdentity): boolean => {
  const key = machineIdentityKey(left);
  return key !== null && key === machineIdentityKey(right);
};

/** The identity a saved entry last verified, else the one stored with it. */
export const savedEntryMachineIdentity = (
  snapshot: Pick<SavedDevicesSnapshot, "devices" | "verifiedByDeviceId">,
  deviceId: string,
): MachineIdentity => {
  const verified = snapshot.verifiedByDeviceId?.[deviceId];
  const device = snapshot.devices.find((entry) => entry.id === deviceId);
  return {
    uniqueId: verified?.uniqueId ?? device?.lastKnownUniqueId ?? null,
    hostname: verified?.hostname ?? device?.lastKnownHostname ?? null,
  };
};
