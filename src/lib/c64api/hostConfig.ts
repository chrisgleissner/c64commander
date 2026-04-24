/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { variant } from "@/generated/variant";

const SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1";
const LEGACY_DEVICE_HOST_KEY = "c64u_device_host";
export const CURRENT_DEVICE_HOST_KEY = `${variant.id}:device_host`;
const CURRENT_BASE_URL_KEY = "c64u_base_url";

export const persistDeviceHostToStorage = (deviceHost: string) => {
  localStorage.setItem(CURRENT_DEVICE_HOST_KEY, deviceHost);
  localStorage.setItem(LEGACY_DEVICE_HOST_KEY, deviceHost);
};

export const DEFAULT_DEVICE_HOST = variant.runtime.endpoints.device_host ?? "c64u";
export const DEFAULT_BASE_URL = `http://${DEFAULT_DEVICE_HOST}`;
export const DEFAULT_HTTP_PORT = 80;
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

const parsePort = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
};

const splitNormalizedDeviceHost = (deviceHost?: string) => {
  const normalized = normalizeDeviceHost(deviceHost);

  if (normalized.startsWith("[")) {
    const closeBracketIndex = normalized.indexOf("]");
    if (closeBracketIndex !== -1) {
      const host = normalized.slice(0, closeBracketIndex + 1);
      const rest = normalized.slice(closeBracketIndex + 1);
      if (rest.startsWith(":")) {
        const httpPort = parsePort(rest.slice(1));
        if (httpPort !== null) {
          return { host, httpPort };
        }
      }
      return { host, httpPort: null };
    }
  }

  const colonCount = (normalized.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const separatorIndex = normalized.lastIndexOf(":");
    const httpPort = parsePort(normalized.slice(separatorIndex + 1));
    if (httpPort !== null) {
      return {
        host: normalized.slice(0, separatorIndex) || DEFAULT_DEVICE_HOST,
        httpPort,
      };
    }
  }

  return { host: normalized, httpPort: null };
};

const formatHostWithOptionalPort = (host: string, httpPort: number | null | undefined) => {
  const normalizedHost = normalizeDeviceHost(host);
  if (httpPort === null || httpPort === undefined || httpPort === DEFAULT_HTTP_PORT) {
    return normalizedHost;
  }
  const hostWithBrackets =
    normalizedHost.includes(":") && !normalizedHost.startsWith("[") ? `[${normalizedHost}]` : normalizedHost;
  return `${hostWithBrackets}:${httpPort}`;
};

export const stripPortFromDeviceHost = (deviceHost?: string) => splitNormalizedDeviceHost(deviceHost).host;

export const getDeviceHostHttpPort = (deviceHost?: string, baseUrl?: string) => {
  const { httpPort } = splitNormalizedDeviceHost(deviceHost);
  if (httpPort !== null) {
    return httpPort;
  }

  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.port) {
        return parsePort(parsed.port) ?? DEFAULT_HTTP_PORT;
      }
      if (parsed.protocol === "https:") {
        return 443;
      }
    } catch (error) {
      addLog("warn", "Failed to parse base URL for HTTP port detection", {
        baseUrl,
        error: (error as Error).message,
      });
    }
  }

  return DEFAULT_HTTP_PORT;
};

export const buildDeviceHostWithHttpPort = (host?: string, httpPort?: number | null) =>
  formatHostWithOptionalPort(host ?? DEFAULT_DEVICE_HOST, httpPort ?? null);

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
  const savedDevicesRaw = localStorage.getItem(SAVED_DEVICES_STORAGE_KEY);
  if (savedDevicesRaw) {
    try {
      const parsed = JSON.parse(savedDevicesRaw) as {
        selectedDeviceId?: string;
        devices?: Array<{ id?: string; host?: string; httpPort?: number }>;
      };
      const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
      const selected = devices.find((device) => device.id === parsed.selectedDeviceId) ?? devices[0];
      if (selected?.host) {
        return buildDeviceHostWithHttpPort(selected.host, selected.httpPort ?? DEFAULT_HTTP_PORT);
      }
    } catch (error) {
      addLog("warn", "Failed to parse saved devices while resolving device host", {
        error: (error as Error).message,
      });
    }
  }
  const storedCurrentDeviceHost = localStorage.getItem(CURRENT_DEVICE_HOST_KEY);
  const legacyStoredDeviceHost = localStorage.getItem(LEGACY_DEVICE_HOST_KEY);
  let currentStoredDeviceHost = storedCurrentDeviceHost;
  if (legacyStoredDeviceHost) {
    const normalizedLegacyHost = normalizeDeviceHost(legacyStoredDeviceHost);
    if (normalizedLegacyHost !== legacyStoredDeviceHost) {
      localStorage.setItem(LEGACY_DEVICE_HOST_KEY, normalizedLegacyHost);
    }
    const normalizedCurrentHost = storedCurrentDeviceHost ? normalizeDeviceHost(storedCurrentDeviceHost) : null;
    if (!normalizedCurrentHost || normalizedCurrentHost === DEFAULT_DEVICE_HOST) {
      persistDeviceHostToStorage(normalizedLegacyHost);
      currentStoredDeviceHost = normalizedLegacyHost;
    }
  }
  const storedDeviceHost = currentStoredDeviceHost;
  const normalizedStoredHost = normalizeDeviceHost(storedDeviceHost);
  if (storedDeviceHost) {
    persistDeviceHostToStorage(normalizedStoredHost);
    localStorage.removeItem(CURRENT_BASE_URL_KEY);
    return normalizedStoredHost;
  }
  const legacyBaseUrl = localStorage.getItem(CURRENT_BASE_URL_KEY) ?? localStorage.getItem("c64u_base_url");
  if (legacyBaseUrl) {
    const migratedHost = normalizeDeviceHost(getDeviceHostFromBaseUrl(legacyBaseUrl));
    persistDeviceHostToStorage(migratedHost);
    localStorage.removeItem(CURRENT_BASE_URL_KEY);
    return migratedHost;
  }
  localStorage.removeItem(CURRENT_BASE_URL_KEY);
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
