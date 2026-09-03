import dns from "node:dns/promises";

import { getHostnameFromHostValue, isPrivateIpAddress, isTrustedInsecureHost } from "./hostValidation.js";

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
