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
import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { assertDeviceTrafficAllowed } from "@/lib/appMode/deviceTrafficGate";

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
  } catch (error) {
    addLog(
      "debug",
      "Failed to parse Telnet test-probe host candidate",
      buildErrorLogDetails(error as Error, { value }),
    );
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
/**
 * The simulated device's Telnet, loaded on first use: it serves Demo Mode and tests only, and kept
 * in the startup bundle it pushed that bundle over its size budget.
 */
const createDeferredMockTransport = (): TelnetTransport => {
  let mock: TelnetTransport | null = null;
  const load = async () => {
    mock ??= new (await import("@/lib/telnet/telnetMock")).TelnetMock();
    return mock;
  };
  return {
    connect: async (host, port) => (await load()).connect(host, port),
    disconnect: async () => (await load()).disconnect(),
    send: async (data) => (await load()).send(data),
    read: async (timeoutMs) => (await load()).read(timeoutMs),
    isConnected: () => mock?.isConnected() ?? false,
  };
};

/**
 * The native plugin holds one socket for the whole app, and its connect closes whichever socket is open. Telnet is
 * serialized only per device, so a session to another device would take the socket over mid-workflow and receive the
 * first session's keystrokes. Every native session therefore holds this app-wide lease from connect to disconnect.
 */
export const TELNET_SOCKET_LEASE_TIMEOUT_MS = 30_000;

let nativeSocketHolder: object | null = null;
let nativeSocketReleaseWaiters: Array<() => void> = [];

const waitForNativeSocketRelease = (timeoutMs: number) =>
  new Promise<void>((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      nativeSocketReleaseWaiters = nativeSocketReleaseWaiters.filter((waiter) => waiter !== wake);
      resolve();
    };
    const timer = setTimeout(wake, timeoutMs);
    nativeSocketReleaseWaiters.push(wake);
  });

const acquireNativeSocket = async (holder: object, host: string, port: number) => {
  const deadline = Date.now() + TELNET_SOCKET_LEASE_TIMEOUT_MS;
  while (nativeSocketHolder !== null && nativeSocketHolder !== holder) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      addLog("warn", "Telnet socket still held by another session; taking it over", {
        host,
        port,
        waitedMs: TELNET_SOCKET_LEASE_TIMEOUT_MS,
      });
      break;
    }
    await waitForNativeSocketRelease(remainingMs);
  }
  nativeSocketHolder = holder;
};

const releaseNativeSocket = (holder: object) => {
  if (nativeSocketHolder !== holder) return;
  nativeSocketHolder = null;
  const waiters = nativeSocketReleaseWaiters;
  nativeSocketReleaseWaiters = [];
  waiters.forEach((wake) => wake());
};

export function createTelnetClient(options?: CreateTelnetClientOptions): TelnetTransport {
  if (shouldUseMockTelnetTransport()) {
    return createDeferredMockTransport();
  }

  let connected = false;
  const connectTimeoutMs = options?.connectTimeoutMs ?? 5000;
  const socketHolder = {};
  const assertHoldsNativeSocket = () => {
    if (nativeSocketHolder === socketHolder) return;
    connected = false;
    throw new TelnetError("Telnet socket was taken over by another session", "DISCONNECTED");
  };

  return {
    async connect(host: string, port: number): Promise<void> {
      assertDeviceTrafficAllowed("telnet", { host, port });
      await acquireNativeSocket(socketHolder, host, port);
      try {
        await TelnetSocket.connect({ host, port, timeoutMs: connectTimeoutMs });
        connected = true;
      } catch (error) {
        connected = false;
        releaseNativeSocket(socketHolder);
        throw new TelnetError(
          `Failed to connect to ${host}:${port}: ${(error as Error).message}`,
          "CONNECTION_FAILED",
          { host, port },
        );
      }
    },

    async disconnect(): Promise<void> {
      connected = false;
      if (nativeSocketHolder !== socketHolder) return;
      try {
        await TelnetSocket.disconnect();
      } catch (error) {
        addLog("warn", "TelnetSocket.disconnect() failed", buildErrorLogDetails(error as Error));
      } finally {
        releaseNativeSocket(socketHolder);
      }
    },

    async send(data: Uint8Array): Promise<void> {
      if (!connected) {
        throw new TelnetError("Not connected", "DISCONNECTED");
      }
      assertHoldsNativeSocket();
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
      assertHoldsNativeSocket();
      try {
        const result = await TelnetSocket.read({ timeoutMs });
        return base64ToUint8Array(result.data);
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes("timeout") || msg.includes("timed out")) {
          return new Uint8Array(0);
        }
        connected = false;
        const code = /connection closed/i.test(msg) ? "CONNECTION_CLOSED" : "DISCONNECTED";
        throw new TelnetError(`Read failed: ${msg}`, code);
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
