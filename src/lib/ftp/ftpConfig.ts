/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { buildLocalStorageKey } from "@/generated/variant";
import { updateSelectedSavedDevicePorts } from "@/lib/savedDevices/store";

const FTP_PORT_KEY = buildLocalStorageKey("ftp_port");
const FTP_BRIDGE_URL_KEY = buildLocalStorageKey("ftp_bridge_url");
const SAVED_DEVICES_STORAGE_KEY = buildLocalStorageKey("saved_devices:v1");
const DEFAULT_FTP_PORT = 21;

let runtimeFtpPortOverride: number | null = null;

const isValidFtpPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

export const getStoredFtpPort = () => {
  if (runtimeFtpPortOverride !== null) return runtimeFtpPortOverride;
  if (typeof localStorage === "undefined") return DEFAULT_FTP_PORT;
  if (typeof localStorage !== "undefined") {
    const savedDevicesRaw = localStorage.getItem(SAVED_DEVICES_STORAGE_KEY);
    if (savedDevicesRaw) {
      try {
        const parsed = JSON.parse(savedDevicesRaw) as {
          selectedDeviceId?: string;
          devices?: Array<{ id?: string; ftpPort?: number }>;
        };
        const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
        const selected = devices.find((device) => device.id === parsed.selectedDeviceId) ?? devices[0];
        if (typeof selected?.ftpPort === "number" && isValidFtpPort(selected.ftpPort)) {
          return selected.ftpPort;
        }
      } catch (error) {
        console.warn("Failed to parse saved devices while resolving FTP port", { error });
      }
    }
  }
  const raw = localStorage.getItem(FTP_PORT_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!isValidFtpPort(parsed)) return DEFAULT_FTP_PORT;
  return parsed;
};

export const setStoredFtpPort = (port: number) => {
  if (typeof localStorage === "undefined") return;
  if (!isValidFtpPort(port)) return;
  localStorage.setItem(FTP_PORT_KEY, String(port));
  try {
    updateSelectedSavedDevicePorts({ ftpPort: port });
  } catch (error) {
    console.warn("Failed to sync FTP port to selected saved device", { error });
    const savedDevicesRaw = localStorage.getItem(SAVED_DEVICES_STORAGE_KEY);
    if (!savedDevicesRaw) return;
    try {
      const parsed = JSON.parse(savedDevicesRaw) as {
        selectedDeviceId?: string;
        devices?: Array<{ id?: string; ftpPort?: number }>;
      };
      if (!Array.isArray(parsed.devices) || !parsed.selectedDeviceId) return;
      const next = {
        ...parsed,
        devices: parsed.devices.map((device) =>
          device.id === parsed.selectedDeviceId ? { ...device, ftpPort: port } : device,
        ),
      };
      localStorage.setItem(SAVED_DEVICES_STORAGE_KEY, JSON.stringify(next));
    } catch (fallbackError) {
      console.warn("Failed to update saved-device fallback FTP port", { error: fallbackError });
    }
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
