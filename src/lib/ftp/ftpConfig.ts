/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getSelectedSavedDevicePorts, updateSelectedSavedDevicePorts } from "@/lib/savedDevices/store";
import { resolveDeviceHostFromStorage, stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { getPassword } from "@/lib/secureStorage";

const FTP_PORT_KEY = "c64u_ftp_port";
const FTP_BRIDGE_URL_KEY = "c64u_ftp_bridge_url";
const DEFAULT_FTP_PORT = 21;

let runtimeFtpPortOverride: number | null = null;
// Session-scoped FTP password used while demo mode is active: the per-boot mock
// token the authenticated mock FTP server requires. Mirrors the port override —
// set when the mock server starts, cleared when it stops (HARD10-005).
let runtimeFtpPasswordOverride: string | null = null;

const isValidFtpPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

// The port comes from the saved-devices store, which is also what the Settings screen shows.
// Resolving it from the raw envelope here gave the FTP client a different answer whenever the
// store's normalisation and this module's parser disagreed (HARD27-025). The store migrates the
// legacy `c64u_ftp_port` key into the device it creates, so that key needs no separate read.
export const getStoredFtpPort = () => {
  if (runtimeFtpPortOverride !== null) return runtimeFtpPortOverride;
  if (typeof localStorage === "undefined") return DEFAULT_FTP_PORT;
  const { ftpPort } = getSelectedSavedDevicePorts();
  return isValidFtpPort(ftpPort) ? ftpPort : DEFAULT_FTP_PORT;
};

export const setStoredFtpPort = (port: number) => {
  if (typeof localStorage === "undefined") return;
  if (!isValidFtpPort(port)) return;
  localStorage.setItem(FTP_PORT_KEY, String(port));
  try {
    updateSelectedSavedDevicePorts({ ftpPort: port });
  } catch (error) {
    console.warn("Failed to sync FTP port to selected saved device", { error });
  }
};

export const clearStoredFtpPort = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(FTP_PORT_KEY);
  try {
    updateSelectedSavedDevicePorts({ ftpPort: DEFAULT_FTP_PORT });
  } catch (error) {
    console.warn("Failed to reset selected saved-device FTP port", { error });
  }
};

export const setRuntimeFtpPortOverride = (port: number | null) => {
  if (port === null) {
    runtimeFtpPortOverride = null;
    return;
  }
  if (!isValidFtpPort(port)) return;
  runtimeFtpPortOverride = port;
};

export const clearRuntimeFtpPortOverride = () => {
  runtimeFtpPortOverride = null;
};

export const setRuntimeFtpPasswordOverride = (password: string | null) => {
  runtimeFtpPasswordOverride = password && password.length > 0 ? password : null;
};

export const getRuntimeFtpPasswordOverride = () => runtimeFtpPasswordOverride;

export const clearRuntimeFtpPasswordOverride = () => {
  runtimeFtpPasswordOverride = null;
};

export const getFtpBridgeUrl = () => {
  const stored = localStorage.getItem(FTP_BRIDGE_URL_KEY);
  if (stored) return stored;
  if (import.meta.env.VITE_WEB_PLATFORM === "1") {
    return "/api/ftp";
  }
  const envUrl = import.meta.env.VITE_FTP_BRIDGE_URL as string | undefined;
  return envUrl || "";
};

export const setFtpBridgeUrl = (url: string) => {
  if (!url) return;
  localStorage.setItem(FTP_BRIDGE_URL_KEY, url);
};

export const clearFtpBridgeUrl = () => {
  localStorage.removeItem(FTP_BRIDGE_URL_KEY);
};

export const FTP_DEFAULTS = {
  DEFAULT_FTP_PORT,
};

// Shared host/port/credential resolution for direct FTP client calls
// (listFtpDirectory/readFtpFile/writeFtpFile) against the currently selected
// device - mirrors the per-page resolveFtpOptions closures (HomePage's REU
// and config-file workflows) so new FTP consumers (e.g. HARD18-025 disk
// write-back) don't re-derive this by hand.
export const resolveFtpConnectionOptions = async () => {
  const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
  const password = await getPassword();
  return {
    host,
    port: getStoredFtpPort(),
    username: "user",
    password: password ?? "",
  };
};
