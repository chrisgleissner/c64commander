/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

export type MdnsResolverPlugin = {
  resolve(options: { host: string; timeoutMs?: number }): Promise<MdnsResolverResult>;
};

export type MdnsResolverResult = {
  host: string;
  resolvedHost: string;
  ip: string;
  ttlMs: number;
};

const webStub: MdnsResolverPlugin = {
  // Web has no mDNS access from a sandboxed page; the JS layer falls back to
  // the configured host and lets the regular fetch path surface DNS errors.
  resolve: async ({ host }) => {
    throw new Error(`mDNS not supported on web for host '${host}'`);
  },
};

const nativePlugin = registerPlugin<MdnsResolverPlugin>("MdnsResolver", {
  web: () => webStub,
});

export const isBareHostname = (host: string): boolean => {
  const trimmed = host.trim();
  if (!trimmed) return false;
  // IPv4 / IPv6 / dotted name → not a bare mDNS candidate.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) return false;
  if (trimmed.includes(":")) return false;
  if (trimmed.includes(".")) return false;
  return true;
};

export const isMdnsAvailable = (): boolean => Capacitor.getPlatform() === "android";

/**
 * Resolve a bare hostname to an IPv4 address via the platform's mDNS
 * facility. On non-Android platforms this throws so callers can fall back
 * to platform default resolution.
 */
export const resolveMdnsHost = async (
  host: string,
  options: { timeoutMs?: number } = {},
): Promise<MdnsResolverResult> => {
  if (!isMdnsAvailable()) {
    throw new Error("mDNS resolver only available on Android");
  }
  return nativePlugin.resolve({ host, timeoutMs: options.timeoutMs });
};
