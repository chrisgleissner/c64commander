/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { machineIdentityKey, savedEntryMachineIdentity } from "@/lib/savedDevices/machineIdentity";
import type { SavedDevicesSnapshot } from "@/lib/savedDevices/store";

type SavedDevicesForScope = Pick<SavedDevicesSnapshot, "devices" | "verifiedByDeviceId">;

let readSavedDevices: (() => SavedDevicesForScope) | null = null;
const machineScopesBySnapshot = new WeakMap<SavedDevicesForScope, Map<string, string | null>>();

/** Lets the saved-devices store tell this module which hosts are addresses of one machine. */
export const registerSavedDevicesForDeviceScope = (read: (() => SavedDevicesForScope) | null) => {
  readSavedDevices = read;
};

/** A host without its port or IPv6 brackets, in lower case: every port of a host reaches the same network task. */
export const normalizeScopeHost = (host: string) => {
  const normalized = host.trim().toLowerCase();
  if (normalized.startsWith("[")) {
    const closeBracketIndex = normalized.indexOf("]");
    return closeBracketIndex === -1 ? normalized.slice(1) : normalized.slice(1, closeBracketIndex);
  }
  const portSeparatorIndex = normalized.indexOf(":");
  const hasSinglePortSeparator = portSeparatorIndex !== -1 && portSeparatorIndex === normalized.lastIndexOf(":");
  return hasSinglePortSeparator ? normalized.slice(0, portSeparatorIndex) : normalized;
};

const machineScopeOf = (snapshot: SavedDevicesForScope, scopeHost: string): string | null => {
  let scopes = machineScopesBySnapshot.get(snapshot);
  if (!scopes) {
    scopes = new Map();
    machineScopesBySnapshot.set(snapshot, scopes);
  }
  if (scopes.has(scopeHost)) return scopes.get(scopeHost) ?? null;
  const machineKey =
    snapshot.devices
      .filter((device) => normalizeScopeHost(device.host) === scopeHost)
      .map((device) => machineIdentityKey(savedEntryMachineIdentity(snapshot, device.id)))
      .find((key) => key !== null) ?? null;
  const scope = machineKey === null ? null : `machine:${machineKey}`;
  scopes.set(scopeHost, scope);
  return scope;
};

/**
 * The device a host reaches. A saved Ultimate whose identity is known is one scope under every address it was
 * saved with (Ethernet and Wi-Fi), so its addresses share one lane; any other host is its own scope.
 */
export const deviceScopeOfHost = (host: string) => {
  const scopeHost = normalizeScopeHost(host);
  const savedDevices = readSavedDevices?.();
  return (savedDevices && machineScopeOf(savedDevices, scopeHost)) ?? scopeHost;
};

/** The device a REST request is for. On web every request has the proxy's `baseUrl`, so `deviceHost` comes first. */
export const resolveRestDeviceScope = (target: { baseUrl: string; deviceHost?: string }) => {
  const hostFromBaseUrl = target.baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  return deviceScopeOfHost(target.deviceHost?.trim() || hostFromBaseUrl);
};
