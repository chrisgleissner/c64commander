/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { splitSavedDeviceHostAndHttpPort } from "@/lib/savedDevices/host";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";

/**
 * Which Ultimate a disk operation talked to. One Ultimate can answer on two addresses (Ethernet and Wi-Fi) and be
 * saved once per address, so the host alone cannot say whether two operations reached the same machine; the
 * `unique_id` the device reports can, when it is known.
 */
export type DiskDeviceIdentity = { host: string; uniqueId: string | null };

const canonicalHostAndPort = (host: string, httpPort: number) => `${host.toLowerCase()} port ${httpPort}`;

const canonicalDeviceHost = (deviceHost: string) => {
  const { host, httpPort } = splitSavedDeviceHostAndHttpPort(deviceHost);
  return canonicalHostAndPort(host, httpPort);
};

const normalizeUniqueId = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

export const resolveDiskDeviceIdentity = (deviceHost: string): DiskDeviceIdentity => {
  const canonicalHost = canonicalDeviceHost(deviceHost);
  const snapshot = getSavedDevicesSnapshot();
  const uniqueIdOf = (deviceId: string, lastKnownUniqueId: string | null) =>
    normalizeUniqueId(snapshot.verifiedByDeviceId[deviceId]?.uniqueId ?? lastKnownUniqueId);
  const matches = snapshot.devices.filter(
    (device) =>
      canonicalHostAndPort(splitSavedDeviceHostAndHttpPort(device.host).host, device.httpPort) === canonicalHost,
  );
  const selected = matches.find((device) => device.id === snapshot.selectedDeviceId);
  if (selected) return { host: deviceHost, uniqueId: uniqueIdOf(selected.id, selected.lastKnownUniqueId) };
  const uniqueIds = new Set(matches.map((device) => uniqueIdOf(device.id, device.lastKnownUniqueId)));
  const [onlyUniqueId] = uniqueIds;
  return { host: deviceHost, uniqueId: uniqueIds.size === 1 ? (onlyUniqueId ?? null) : null };
};

export const isSameDiskDevice = (a: DiskDeviceIdentity, b: DiskDeviceIdentity) =>
  a.uniqueId && b.uniqueId ? a.uniqueId === b.uniqueId : canonicalDeviceHost(a.host) === canonicalDeviceHost(b.host);

/** True only when both devices reported a unique id and the ids differ; unknown identities may be one machine. */
export const areKnownDifferentDiskDevices = (a: DiskDeviceIdentity, b: DiskDeviceIdentity) =>
  Boolean(a.uniqueId && b.uniqueId && a.uniqueId !== b.uniqueId);

export const isSameDiskDeviceHost = (a: string, b: string) =>
  isSameDiskDevice(resolveDiskDeviceIdentity(a), resolveDiskDeviceIdentity(b));

/** A stable key for per-device disk records: the unique id when known, otherwise the host. */
export const diskDeviceKey = (deviceHost: string) => {
  const identity = resolveDiskDeviceIdentity(deviceHost);
  return identity.uniqueId ? `unique-id#${identity.uniqueId}` : identity.host;
};
