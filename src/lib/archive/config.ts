/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ArchiveClientConfigInput, ArchiveClientResolvedConfig } from "./types";
import { variant } from "@/generated/variant";
import { validateDeviceHost } from "@/lib/validation/connectionValidation";

const DEFAULT_ARCHIVE_HEADERS = {
  "Client-Id": "Commodore",
  "User-Agent": "Assembly Query",
} as const;

export const DEFAULT_ARCHIVE_SOURCE_CONFIG: ArchiveClientConfigInput = {
  id: "archive-commoserve",
  name: "CommoServe",
  baseUrl: variant.runtime.endpoints.commoserve_base_url ?? "http://commoserve.files.commodore.net",
  headers: { ...DEFAULT_ARCHIVE_HEADERS },
  enabled: true,
};

const normalizeOverride = (value?: string | null) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const buildBaseUrlFromHost = (host: string) => `http://${host}`;

export const buildDefaultArchiveClientConfig = (overrides?: {
  hostOverride?: string | null;
  clientIdOverride?: string | null;
  userAgentOverride?: string | null;
  enabled?: boolean;
}): ArchiveClientConfigInput => {
  const defaultUrl = new URL(DEFAULT_ARCHIVE_SOURCE_CONFIG.baseUrl);
  const hostOverride = normalizeOverride(overrides?.hostOverride);
  const clientIdOverride = normalizeOverride(overrides?.clientIdOverride);
  const userAgentOverride = normalizeOverride(overrides?.userAgentOverride);
  const host = hostOverride && !validateArchiveHost(hostOverride) ? hostOverride : defaultUrl.host;

  return {
    id: DEFAULT_ARCHIVE_SOURCE_CONFIG.id,
    name: DEFAULT_ARCHIVE_SOURCE_CONFIG.name,
    baseUrl: buildBaseUrlFromHost(host),
    headers: {
      "Client-Id": clientIdOverride ?? DEFAULT_ARCHIVE_HEADERS["Client-Id"],
      "User-Agent": userAgentOverride ?? DEFAULT_ARCHIVE_HEADERS["User-Agent"],
    },
    enabled: overrides?.enabled ?? DEFAULT_ARCHIVE_SOURCE_CONFIG.enabled,
  };
};

export const validateArchiveHost = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    return "Enter a hostname only, without http:// or https://";
  }
  if (/[/?#]/.test(trimmed)) {
    return "Enter a hostname only, without paths or query strings";
  }
  return validateDeviceHost(trimmed);
};

export const resolveArchiveClientConfig = (input: ArchiveClientConfigInput): ArchiveClientResolvedConfig => {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const parsedUrl = new URL(baseUrl);
  const headers = {
    ...DEFAULT_ARCHIVE_HEADERS,
    ...(input.headers ?? {}),
  };

  return {
    id: input.id,
    name: input.name,
    baseUrl,
    headers,
    enabled: input.enabled ?? true,
    host: parsedUrl.host,
    clientId: headers["Client-Id"],
    userAgent: headers["User-Agent"],
  };
};

export const sanitizeArchiveHeadersForLogging = (headers: Record<string, string>) => ({
  "Accept-Encoding": headers["Accept-Encoding"],
  "Client-Id": headers["Client-Id"],
  "User-Agent": headers["User-Agent"],
});
