/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TelnetTransport } from "@/lib/telnet/telnetTypes";
import { TelnetError } from "@/lib/telnet/telnetTypes";
import { TelnetSocket } from "@/lib/native/telnetSocket";

/**
 * Capacitor-backed Telnet transport using native TCP sockets.
 * Bridges TelnetTransport interface to the TelnetSocket Capacitor plugin.
 */
export function createTelnetClient(): TelnetTransport {
  let connected = false;

  return {
    async connect(host: string, port: number): Promise<void> {
      try {
        await TelnetSocket.connect({ host, port, timeoutMs: 5000 });
        connected = true;
      } catch (error) {
        connected = false;
        throw new TelnetError(
          `Failed to connect to ${host}:${port}: ${(error as Error).message}`,
          "CONNECTION_FAILED",
          { host, port },
        );
      }
    },

    async disconnect(): Promise<void> {
      connected = false;
      try {
        await TelnetSocket.disconnect();
      } catch {
        // Best-effort disconnect; swallow only after flagging disconnected
      }
    },

    async send(data: Uint8Array): Promise<void> {
      if (!connected) {
        throw new TelnetError("Not connected", "DISCONNECTED");
      }
      const base64 = uint8ArrayToBase64(data);
      try {
        await TelnetSocket.send({ data: base64 });
      } catch (error) {
        connected = false;
        throw new TelnetError(`Send failed: ${(error as Error).message}`, "DISCONNECTED");
      }
    },

    async read(timeoutMs: number): Promise<Uint8Array> {
      if (!connected) {
        throw new TelnetError("Not connected", "DISCONNECTED");
      }
      try {
        const result = await TelnetSocket.read({ timeoutMs });
        return base64ToUint8Array(result.data);
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes("timeout") || msg.includes("timed out")) {
          return new Uint8Array(0);
        }
        connected = false;
        throw new TelnetError(`Read failed: ${msg}`, "DISCONNECTED");
      }
    },

    isConnected(): boolean {
      return connected;
    },
  };
}

/** Convert Uint8Array to base64 string for passing through Capacitor bridge */
function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/** Convert base64 string back to Uint8Array */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
