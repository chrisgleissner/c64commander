/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { TELNET_DEFAULT_PORT } from "@/lib/telnet/telnetTypes";
import { getSelectedSavedDevicePorts, updateSelectedSavedDevicePorts } from "@/lib/savedDevices/store";

const TELNET_PORT_KEY = "c64u_telnet_port";

const isValidTelnetPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

// The port comes from the saved-devices store, for the reason given in ftpConfig.getStoredFtpPort
// (HARD27-025). The store migrates the legacy `c64u_telnet_port` key into the device it creates.
export const getStoredTelnetPort = () => {
  if (typeof localStorage === "undefined") return TELNET_DEFAULT_PORT;
  const { telnetPort } = getSelectedSavedDevicePorts();
  return isValidTelnetPort(telnetPort) ? telnetPort : TELNET_DEFAULT_PORT;
};

export const setStoredTelnetPort = (port: number) => {
  if (typeof localStorage === "undefined") return;
  if (!isValidTelnetPort(port)) return;
  localStorage.setItem(TELNET_PORT_KEY, String(port));
  try {
    updateSelectedSavedDevicePorts({ telnetPort: port });
  } catch (error) {
    console.warn("Failed to sync Telnet port to selected saved device", { error });
  }
};

export const clearStoredTelnetPort = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(TELNET_PORT_KEY);
  try {
    updateSelectedSavedDevicePorts({ telnetPort: TELNET_DEFAULT_PORT });
  } catch (error) {
    console.warn("Failed to reset selected saved-device Telnet port", { error });
  }
};
