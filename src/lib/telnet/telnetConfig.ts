/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { TELNET_DEFAULT_PORT } from "@/lib/telnet/telnetTypes";

const TELNET_PORT_KEY = "c64u_telnet_port";

const isValidTelnetPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

const parseTelnetPort = (raw: string | null) => {
  const parsed = raw ? Number(raw) : NaN;
  if (!isValidTelnetPort(parsed)) return TELNET_DEFAULT_PORT;
  return parsed;
};

export const getStoredTelnetPort = () => {
  if (typeof localStorage === "undefined") return TELNET_DEFAULT_PORT;
  return parseTelnetPort(localStorage.getItem(TELNET_PORT_KEY));
};

export const setStoredTelnetPort = (port: number) => {
  if (typeof localStorage === "undefined") return;
  if (!isValidTelnetPort(port)) return;
  localStorage.setItem(TELNET_PORT_KEY, String(port));
};

export const clearStoredTelnetPort = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(TELNET_PORT_KEY);
};
