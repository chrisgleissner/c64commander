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
import { TelnetMock } from "@/lib/telnet/telnetMock";
import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";

type CreateTelnetClientOptions = {
  connectTimeoutMs?: number;
};

const isTestProbeEnabled = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return true;
  if (typeof window !== "undefined") {
    return (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled === true;
  }
  if (typeof process !== "undefined" && process.env?.VITE_ENABLE_TEST_PROBES === "1") return true;
  return false;
};

const extractHost = (value?: string | null) => {
  if (!value) return null;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    return new URL(value, base).host || null;
  } catch {
    return null;
  }
};

export const shouldUseMockTelnetTransport = () => {
  if (getConnectionSnapshot().state === "DEMO_ACTIVE") {
    return true;
  }
  if (typeof window === "undefined" || !isTestProbeEnabled()) {
    return false;
  }

  const win = window as Window & {
    __c64uExpectedBaseUrl?: string;
    __c64uMockServerBaseUrl?: string;
  };
  const storedHost = resolveDeviceHostFromStorage();
  if (!storedHost) {
    return false;
  }

  return [win.__c64uExpectedBaseUrl, win.__c64uMockServerBaseUrl]
    .map((candidate) => extractHost(candidate))
    .some((candidateHost) => candidateHost === storedHost);
};

/**
 * Capacitor-backed Telnet transport using native TCP sockets.
 * Bridges TelnetTransport interface to the TelnetSocket Capacitor plugin.
 */
export function createTelnetClient(options?: CreateTelnetClientOptions): TelnetTransport {
  if (shouldUseMockTelnetTransport()) {
    return new TelnetMock();
  }

  let connected = false;
  const connectTimeoutMs = options?.connectTimeoutMs ?? 5000;

  return {
    async connect(host: string, port: number): Promise<void> {
      try {
        await TelnetSocket.connect({ host, port, timeoutMs: connectTimeoutMs });
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
      } catch (error) {
        console.warn("TelnetSocket.disconnect() failed", { error });
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
