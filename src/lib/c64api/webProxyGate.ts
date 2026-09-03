/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";

/**
 * HARD27-029 / HARD27-030: on the web platform every device call goes through
 * the app's own Node proxy, which answers 401 for its expired login session and
 * 403 for a host its policy refuses. Both statuses otherwise mean "the device
 * wants its network password", so the proxy names its own gates in this header
 * and the client keeps the device password dialog for the device.
 *
 * Kept in step with `GATE_HEADER` in `web/server/src/index.ts`, which cannot
 * import from `src/` (its tsconfig roots at `web/server/src`).
 */
export const WEB_PROXY_GATE_HEADER = "x-c64commander-gate";

export type WebProxyGate = "session-expired" | "host-policy";

export const WEB_LOGIN_PATH = "/login";

const isWebProxyGate = (value: string): value is WebProxyGate => value === "session-expired" || value === "host-policy";

export const readWebProxyGate = (headers: Headers | null | undefined): WebProxyGate | null => {
  const value = headers?.get(WEB_PROXY_GATE_HEADER)?.trim().toLowerCase();
  if (!value || !isWebProxyGate(value)) return null;
  // A device could send the header too; only the web build has a proxy in front
  // of it, so nothing else may act on one.
  return isNativePlatform() ? null : value;
};

let loginRedirectRequested = false;

/**
 * Send the browser to the server's login page once, carrying the current route
 * so the user returns to it. A no-op when already on the login page.
 */
export const redirectToWebLogin = (
  targetLocation: Location | null = typeof window === "undefined" ? null : window.location,
) => {
  if (!targetLocation || loginRedirectRequested) return false;
  if (targetLocation.pathname === WEB_LOGIN_PATH) return false;
  loginRedirectRequested = true;
  const next = `${targetLocation.pathname}${targetLocation.search}${targetLocation.hash}`;
  addLog("info", "Web session expired; returning to the login page", { next });
  targetLocation.assign(`${WEB_LOGIN_PATH}?next=${encodeURIComponent(next)}`);
  return true;
};

/**
 * Handle a proxy-originated response. Returns true when the response came from
 * the server's own gate, which means the caller must not treat it as the device
 * demanding its password.
 */
export const handleWebProxyGate = (headers: Headers | null | undefined): boolean => {
  const gate = readWebProxyGate(headers);
  if (!gate) return false;
  if (gate === "session-expired") redirectToWebLogin();
  return true;
};

export const resetWebProxyGateForTests = () => {
  loginRedirectRequested = false;
};
