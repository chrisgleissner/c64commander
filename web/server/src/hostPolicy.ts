import dns from "node:dns/promises";
import net from "node:net";

import {
  getHostnameFromHostValue,
  isPrivateIpAddress,
  isTrustedInsecureHost,
  normalizeHostname,
} from "./hostValidation.js";

export type HostAddressResolver = (hostname: string) => Promise<string[]>;

export interface LanHostPolicy {
  isLanHost: (hostValue: string) => Promise<boolean>;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 256;

export const resolveHostAddresses: HostAddressResolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

// HARD27-030: the allow-list was a fixed set of names, so a device saved under
// the name its router advertises - or under `u64`, which the app's own
// discovery probes for - was refused and the app then asked for a network
// password no answer satisfied. A name is accepted when every address it
// resolves to is private-range, which is what "on my LAN" actually means.
// Results are cached for a short TTL so a per-request DNS lookup does not sit
// in front of every proxied call.
//
// The gate resolves the name and the proxied request then resolves it again, so
// a name whose DNS answers a private address here and a public one there is not
// caught, and the cache widens that window to its TTL. Pinning the resolved
// address for the connection would close it, but it would also change the Host
// header the device sees and the address the FTP handlers dial, so it is not a
// change to make alongside this one. The exposure is a LAN-only proxy reachable
// by a host name the user themselves saved, which is a long way from the
// misconfiguration this policy exists to fix.
export const createLanHostPolicy = (options: {
  resolve?: HostAddressResolver;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}): LanHostPolicy => {
  const resolve = options.resolve ?? resolveHostAddresses;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAtMs: number; allowed: boolean }>();

  const remember = (key: string, allowed: boolean) => {
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { allowed, expiresAtMs: now() + ttlMs });
  };

  return {
    isLanHost: async (hostValue: string) => {
      const hostname = getHostnameFromHostValue(hostValue);
      if (!hostname) return false;
      if (isTrustedInsecureHost(hostname)) return true;

      const cached = cache.get(hostname);
      if (cached && cached.expiresAtMs > now()) return cached.allowed;

      let allowed = false;
      try {
        const addresses = await resolve(hostname);
        allowed = addresses.length > 0 && addresses.every((address) => isPrivateIpAddress(address));
      } catch {
        // An unresolvable name is not a LAN device; the caller answers with its
        // own policy status, which the client does not read as device auth.
        allowed = false;
      }
      remember(hostname, allowed);
      return allowed;
    },
  };
};

export interface DeviceAddressMatcher {
  isConfiguredDevice: (candidateHostname: string, configuredHostname: string) => Promise<boolean>;
}

const DEFAULT_RESOLVE_TIMEOUT_MS = 2000;

// An Ultimate on Ethernet and Wi-Fi is one machine at two addresses. A request that names one of the
// configured host's own addresses as an IP literal reaches that machine, and a literal is connected to
// as given, so no later lookup can redirect it. Other names are never resolved here: a name that also
// resolves to the device's address could still send the connection, and the password, elsewhere.
export const createDeviceAddressMatcher = (options: {
  resolve?: HostAddressResolver;
  ttlMs?: number;
  maxEntries?: number;
  resolveTimeoutMs?: number;
  now?: () => number;
  onResolveError?: (hostname: string, error: unknown) => void;
}): DeviceAddressMatcher => {
  const resolve = options.resolve ?? resolveHostAddresses;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const resolveTimeoutMs = options.resolveTimeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAtMs: number; addresses: string[] }>();

  const resolveWithDeadline = (hostname: string): Promise<string[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`DNS lookup of ${hostname} took longer than ${resolveTimeoutMs} ms`)),
        resolveTimeoutMs,
      );
    });
    return Promise.race([resolve(hostname), deadline]).finally(() => clearTimeout(timer));
  };

  const addressesOf = async (hostname: string): Promise<string[]> => {
    if (net.isIP(hostname)) return [hostname];
    const cached = cache.get(hostname);
    if (cached && cached.expiresAtMs > now()) return cached.addresses;
    let addresses: string[] = [];
    try {
      addresses = (await resolveWithDeadline(hostname)).map(normalizeHostname);
    } catch (error) {
      options.onResolveError?.(hostname, error);
    }
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(hostname, { addresses, expiresAtMs: now() + ttlMs });
    return addresses;
  };

  return {
    isConfiguredDevice: async (candidateHostname: string, configuredHostname: string) => {
      const candidate = normalizeHostname(candidateHostname);
      const configured = normalizeHostname(configuredHostname);
      if (!candidate || !configured) return false;
      if (candidate === configured) return true;
      if (!net.isIP(candidate)) return false;
      return (await addressesOf(configured)).includes(candidate);
    },
  };
};
