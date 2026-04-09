/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { TELNET_DEFAULT_PORT } from "@/lib/telnet/telnetTypes";
import { updateSelectedSavedDevicePorts } from "@/lib/savedDevices/store";

const TELNET_PORT_KEY = "c64u_telnet_port";
const SAVED_DEVICES_STORAGE_KEY = "c64u_saved_devices:v1";

const isValidTelnetPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

const parseTelnetPort = (raw: string | null) => {
  const parsed = raw ? Number(raw) : NaN;
  if (!isValidTelnetPort(parsed)) return TELNET_DEFAULT_PORT;
  return parsed;
};

export const getStoredTelnetPort = () => {
  if (typeof localStorage === "undefined") return TELNET_DEFAULT_PORT;
  const savedDevicesRaw = localStorage.getItem(SAVED_DEVICES_STORAGE_KEY);
  if (savedDevicesRaw) {
    try {
      const parsed = JSON.parse(savedDevicesRaw) as {
        selectedDeviceId?: string;
        devices?: Array<{ id?: string; telnetPort?: number }>;
      };
      const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
      const selected = devices.find((device) => device.id === parsed.selectedDeviceId) ?? devices[0];
      if (typeof selected?.telnetPort === "number" && isValidTelnetPort(selected.telnetPort)) {
        return selected.telnetPort;
      }
    } catch {
      // Ignore parse errors and fall back to legacy storage.
    }
  }
  return parseTelnetPort(localStorage.getItem(TELNET_PORT_KEY));
};

export const setStoredTelnetPort = (port: number) => {
  if (typeof localStorage === "undefined") return;
  if (!isValidTelnetPort(port)) return;
  localStorage.setItem(TELNET_PORT_KEY, String(port));
  try {
    updateSelectedSavedDevicePorts({ telnetPort: port });
  } catch {
    const savedDevicesRaw = localStorage.getItem(SAVED_DEVICES_STORAGE_KEY);
    if (!savedDevicesRaw) return;
    try {
      const parsed = JSON.parse(savedDevicesRaw) as {
        selectedDeviceId?: string;
        devices?: Array<{ id?: string; telnetPort?: number }>;
      };
      if (!Array.isArray(parsed.devices) || !parsed.selectedDeviceId) return;
      const next = {
        ...parsed,
        devices: parsed.devices.map((device) =>
          device.id === parsed.selectedDeviceId ? { ...device, telnetPort: port } : device,
        ),
      };
      localStorage.setItem(SAVED_DEVICES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore parse errors and keep legacy storage updated.
    }
  }
};

export const clearStoredTelnetPort = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(TELNET_PORT_KEY);
};
