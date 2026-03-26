/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { WebPlugin } from "@capacitor/core";
import type {
  TelnetSocketPlugin,
  TelnetSocketConnectOptions,
  TelnetSocketSendOptions,
  TelnetSocketReadOptions,
  TelnetSocketReadResult,
} from "@/lib/native/telnetSocket";
import { TelnetError } from "@/lib/telnet/telnetTypes";

/**
 * Web implementation of TelnetSocket.
 * Browsers cannot open raw TCP sockets, so all methods throw.
 * Telnet UI surfaces should be hidden on web.
 */
export class TelnetSocketWeb extends WebPlugin implements TelnetSocketPlugin {
  async connect(_options: TelnetSocketConnectOptions): Promise<void> {
    throw new TelnetError("Telnet is not supported on the web platform", "CONNECTION_FAILED");
  }

  async disconnect(): Promise<void> {
    // No-op — nothing to disconnect on web
  }

  async send(_options: TelnetSocketSendOptions): Promise<void> {
    throw new TelnetError("Telnet is not supported on the web platform", "CONNECTION_FAILED");
  }

  async read(_options: TelnetSocketReadOptions): Promise<TelnetSocketReadResult> {
    throw new TelnetError("Telnet is not supported on the web platform", "CONNECTION_FAILED");
  }

  async isConnected(): Promise<{ connected: boolean }> {
    return { connected: false };
  }
}
