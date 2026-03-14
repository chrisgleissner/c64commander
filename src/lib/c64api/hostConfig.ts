/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

export const DEFAULT_BASE_URL = "http://c64u";
export const DEFAULT_DEVICE_HOST = "c64u";
export const DEFAULT_PROXY_URL = "http://127.0.0.1:8787";
export const WEB_PROXY_PATH = "/api/rest";

const sanitizeHostInput = (input?: string) => {
  const raw = input?.trim() ?? "";
  if (!raw) return "";
  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return url.host || url.hostname || "";
    } catch (error) {
      addLog("warn", "Failed to parse host from URL input", {
        input: raw,
        error: (error as Error).message,
      });
      return "";
    }
  }
  return raw.split("/")[0] ?? "";
};

export const normalizeDeviceHost = (input?: string) => {
  const sanitized = sanitizeHostInput(input);
  return sanitized || DEFAULT_DEVICE_HOST;
};

export const getDeviceHostFromBaseUrl = (baseUrl?: string) => {
  if (!baseUrl) return DEFAULT_DEVICE_HOST;
  try {
    const url = new URL(baseUrl);
    return url.host || DEFAULT_DEVICE_HOST;
  } catch (error) {
    addLog("warn", "Failed to parse device host from base URL", {
      baseUrl,
      error: (error as Error).message,
    });
    return normalizeDeviceHost(baseUrl);
  }
};

export const buildBaseUrlFromDeviceHost = (deviceHost?: string) => `http://${normalizeDeviceHost(deviceHost)}`;

export const resolvePlatformApiBaseUrl = (deviceHost: string, baseUrl?: string) => {
  if (import.meta.env.VITE_WEB_PLATFORM === "1" && typeof window !== "undefined") {
    return `${window.location.origin.replace(/\/$/, "")}${WEB_PROXY_PATH}`;
  }
  if (baseUrl) {
    return baseUrl.replace(/\/$/, "");
  }
  return buildBaseUrlFromDeviceHost(deviceHost);
};

export const resolveDeviceHostFromStorage = () => {
  if (typeof localStorage === "undefined") return DEFAULT_DEVICE_HOST;
  const storedDeviceHost = localStorage.getItem("c64u_device_host");
  const normalizedStoredHost = normalizeDeviceHost(storedDeviceHost);
  if (storedDeviceHost) {
    localStorage.removeItem("c64u_base_url");
    return normalizedStoredHost;
  }
  const legacyBaseUrl = localStorage.getItem("c64u_base_url");
  if (legacyBaseUrl) {
    const migratedHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(legacyBaseUrl));
    localStorage.setItem("c64u_device_host", migratedHost);
    localStorage.removeItem("c64u_base_url");
    return migratedHost;
  }
  localStorage.removeItem("c64u_base_url");
  return normalizedStoredHost;
};

export const isLocalProxy = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch (error) {
    addLog("warn", "Failed to parse base URL for proxy detection", {
      baseUrl,
      error: (error as Error).message,
    });
    return false;
  }
};

const isLocalDeviceHost = (host: string) => {
  let normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("[")) {
    const closingBracketIndex = normalized.indexOf("]");
    if (closingBracketIndex !== -1) {
      normalized = normalized.slice(1, closingBracketIndex);
    }
  } else {
    const colonIndex = normalized.indexOf(":");
    if (colonIndex !== -1) {
      normalized = normalized.slice(0, colonIndex);
    }
  }
  return normalized === "localhost" || normalized === "127.0.0.1";
};

export const resolvePreferredDeviceHost = (baseUrl: string, deviceHost?: string) => {
  const explicitHost = deviceHost ? normalizeDeviceHost(deviceHost) : null;
  const derivedHost = normalizeDeviceHost(explicitHost ?? getDeviceHostFromBaseUrl(baseUrl));
  const storedHost = resolveDeviceHostFromStorage();
  if (!explicitHost && derivedHost === DEFAULT_DEVICE_HOST && storedHost !== DEFAULT_DEVICE_HOST) {
    addLog("info", "Using stored device host instead of default hostname", {
      baseUrl,
      derivedHost,
      storedHost,
    });
    return storedHost;
  }
  const isLikelyFallbackOrigin = (() => {
    if (typeof window === "undefined") return false;
    const origin = window.location?.origin;
    return Boolean(origin && (baseUrl === origin || baseUrl.startsWith(`${origin}/`)));
  })();
  if (!explicitHost && isLocalDeviceHost(derivedHost) && isLikelyFallbackOrigin) {
    if (!isLocalDeviceHost(storedHost)) {
      addLog("warn", "Ignoring localhost base URL in favor of stored host", {
        baseUrl,
        derivedHost,
        storedHost,
      });
      return storedHost;
    }
  }
  return derivedHost;
};
