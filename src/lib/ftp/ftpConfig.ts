/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const FTP_PORT_KEY = 'c64u_ftp_port';
const FTP_BRIDGE_URL_KEY = 'c64u_ftp_bridge_url';
const DEFAULT_FTP_PORT = 21;

let runtimeFtpPortOverride: number | null = null;

export const getStoredFtpPort = () => {
  if (runtimeFtpPortOverride !== null) return runtimeFtpPortOverride;
  const raw = localStorage.getItem(FTP_PORT_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FTP_PORT;
  return parsed;
};

export const setStoredFtpPort = (port: number) => {
  if (!Number.isFinite(port) || port <= 0) return;
  localStorage.setItem(FTP_PORT_KEY, String(port));
};

export const clearStoredFtpPort = () => {
  localStorage.removeItem(FTP_PORT_KEY);
};

export const setRuntimeFtpPortOverride = (port: number | null) => {
  if (port === null) {
    runtimeFtpPortOverride = null;
    return;
  }
  if (!Number.isFinite(port) || port <= 0) return;
  runtimeFtpPortOverride = port;
};

export const clearRuntimeFtpPortOverride = () => {
  runtimeFtpPortOverride = null;
};

export const getFtpBridgeUrl = () => {
  const stored = localStorage.getItem(FTP_BRIDGE_URL_KEY);
  if (stored) return stored;
  const envUrl = import.meta.env.VITE_FTP_BRIDGE_URL as string | undefined;
  return envUrl || '';
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
