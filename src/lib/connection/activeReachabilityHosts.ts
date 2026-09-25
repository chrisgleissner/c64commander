/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getC64APIConfigSnapshot, resolveDeviceHostFromStorage } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { reportFallback } from "@/lib/diagnostics/fallbackReporter";
import { getActiveMockBaseUrl } from "@/lib/mock/mockServer";

export const normalizeReachabilityHost = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const stripScheme = () => stripPortFromDeviceHost(trimmed.replace(/^https?:\/\//, "")).toLowerCase();
  // Most callers pass a bare host such as `c64u`, which `new URL` rejects. Only try the URL parse
  // when the value actually carries a scheme, so the catch below reports a genuinely malformed
  // value rather than the common case.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return stripScheme();
  try {
    return stripPortFromDeviceHost(new URL(trimmed).host).toLowerCase();
  } catch (error) {
    reportFallback("activeReachabilityHosts.normalizeReachabilityHost", error);
    return stripScheme();
  }
};

/** Every spelling of the device the app is connected to: its runtime routing and its persisted host. */
export const getActiveReachabilityHosts = () => {
  const config = getC64APIConfigSnapshot();
  const hosts = [
    normalizeReachabilityHost(config.deviceHost),
    normalizeReachabilityHost(config.baseUrl),
    normalizeReachabilityHost(resolveDeviceHostFromStorage()),
  ].filter((host): host is string => host !== null);
  return new Set(hosts);
};

export const isActiveReachabilityHost = (host: string): boolean => {
  const normalizedHost = normalizeReachabilityHost(host);
  return normalizedHost !== null && getActiveReachabilityHosts().has(normalizedHost);
};

export const isActiveMockHost = (normalizedHost: string) => {
  const mockBaseUrl = getActiveMockBaseUrl();
  return Boolean(mockBaseUrl) && normalizeReachabilityHost(mockBaseUrl) === normalizedHost;
};
