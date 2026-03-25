/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ArchiveBackend, ArchiveClientConfigInput, ArchiveClientResolvedConfig } from "./types";
import { validateDeviceHost } from "@/lib/validation/connectionValidation";

export const ARCHIVE_BACKEND_DEFAULTS: Record<
  ArchiveBackend,
  Omit<ArchiveClientResolvedConfig, "backend" | "baseUrl">
> = {
  commodore: {
    host: "commoserve.files.commodore.net",
    clientId: "Commodore",
    userAgent: "Assembly Query",
  },
  assembly64: {
    host: "hackerswithstyle.se",
    clientId: "Ultimate",
    userAgent: "Assembly Query",
  },
};

const normalizeOverride = (value?: string | null) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
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
  const defaults = ARCHIVE_BACKEND_DEFAULTS[input.backend];
  const hostOverride = normalizeOverride(input.hostOverride);
  const clientIdOverride = normalizeOverride(input.clientIdOverride);
  const userAgentOverride = normalizeOverride(input.userAgentOverride);
  const host = hostOverride && !validateArchiveHost(hostOverride) ? hostOverride : defaults.host;
  const clientId = clientIdOverride ?? defaults.clientId;
  const userAgent = userAgentOverride ?? defaults.userAgent;

  return {
    backend: input.backend,
    host,
    clientId,
    userAgent,
    baseUrl: `http://${host}`,
  };
};

export const sanitizeArchiveHeadersForLogging = (headers: Record<string, string>) => ({
  "Accept-Encoding": headers["Accept-Encoding"],
  "Client-Id": headers["Client-Id"],
  "User-Agent": headers["User-Agent"],
});
