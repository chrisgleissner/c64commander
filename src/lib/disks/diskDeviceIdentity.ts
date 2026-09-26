/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { splitSavedDeviceHostAndHttpPort } from "@/lib/savedDevices/host";
import { isSameMachine, machineIdentityKey, savedEntryMachineIdentity } from "@/lib/savedDevices/machineIdentity";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";

/**
 * Which Ultimate a disk operation talked to. One Ultimate can answer on two addresses (Ethernet and Wi-Fi) and be
 * saved once per address, so the host alone cannot say whether two operations reached the same machine; the
 * `unique_id` and hostname the device reports can, when both are known (see `machineIdentityKey`).
 */
export type DiskDeviceIdentity = { host: string; uniqueId: string | null; hostname: string | null };

const canonicalHostAndPort = (host: string, httpPort: number) => `${host.toLowerCase()} port ${httpPort}`;

const canonicalDeviceHost = (deviceHost: string) => {
  const { host, httpPort } = splitSavedDeviceHostAndHttpPort(deviceHost);
  return canonicalHostAndPort(host, httpPort);
};

const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

export const resolveDiskDeviceIdentity = (deviceHost: string): DiskDeviceIdentity => {
  const canonicalHost = canonicalDeviceHost(deviceHost);
  const snapshot = getSavedDevicesSnapshot();
  const identityOf = (deviceId: string) => {
    const { uniqueId, hostname } = savedEntryMachineIdentity(snapshot, deviceId);
    return { host: deviceHost, uniqueId: normalize(uniqueId), hostname: normalize(hostname) };
  };
  const matches = snapshot.devices.filter(
    (device) =>
      canonicalHostAndPort(splitSavedDeviceHostAndHttpPort(device.host).host, device.httpPort) === canonicalHost,
  );
  const selected = matches.find((device) => device.id === snapshot.selectedDeviceId);
  if (selected) return identityOf(selected.id);
  const identities = new Map(
    matches.map((device) => identityOf(device.id)).map((identity) => [JSON.stringify(identity), identity]),
  );
  const [onlyIdentity] = identities.values();
  return identities.size === 1 && onlyIdentity ? onlyIdentity : { host: deviceHost, uniqueId: null, hostname: null };
};

/** True only when both devices reported a unique id and the ids differ; unknown identities may be one machine. */
export const areKnownDifferentDiskDevices = (a: DiskDeviceIdentity, b: DiskDeviceIdentity) =>
  Boolean(a.uniqueId && b.uniqueId && a.uniqueId !== b.uniqueId);

export const isSameDiskDevice = (a: DiskDeviceIdentity, b: DiskDeviceIdentity) => {
  if (areKnownDifferentDiskDevices(a, b)) return false;
  return isSameMachine(a, b) || canonicalDeviceHost(a.host) === canonicalDeviceHost(b.host);
};

export const isSameDiskDeviceHost = (a: string, b: string) =>
  isSameDiskDevice(resolveDiskDeviceIdentity(a), resolveDiskDeviceIdentity(b));

/** A stable key for per-device disk records: the machine identity when known, otherwise the host. */
export const diskDeviceKey = (deviceHost: string) => {
  const identity = resolveDiskDeviceIdentity(deviceHost);
  const machineKey = machineIdentityKey(identity);
  return machineKey ? `machine#${machineKey}` : identity.host;
};
