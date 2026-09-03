/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import { MockC64U } from "@/lib/native/mockC64u";
import { isNativePlatform } from "@/lib/native/platform";

let activeMockBaseUrl: string | null = null;
let activeFtpPort: number | null = null;
let activeMockToken: string | null = null;
let startPromise: Promise<{ baseUrl: string; ftpPort?: number; token?: string }> | null = null;

const loadMockConfigPayload = async () => {
  const module = await import("@/lib/mock/mockConfig");
  return module.getMockConfigPayload();
};

// HARD27-027: only a native build carries the simulated device (an HTTP server
// inside the app). A browser build has no such server, so Demo Mode there would
// be a badge over requests still going to the real, unreachable host. A build
// under test probes keeps the demo path: the E2E and screenshot runs drive it
// deliberately, with or without an injected mock server.
export const isSimulatedDeviceAvailable = (): boolean => {
  if (isNativePlatform()) return true;
  if (typeof window !== "undefined") {
    const win = window as Window & { __c64uMockServerBaseUrl?: string; __c64uTestProbeEnabled?: boolean };
    if (win.__c64uMockServerBaseUrl) return true;
    if (win.__c64uTestProbeEnabled) return true;
  }
  const env = import.meta.env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
  return env?.VITE_ENABLE_TEST_PROBES === "1";
};

export const getActiveMockBaseUrl = () => activeMockBaseUrl;
export const getActiveMockFtpPort = () => activeFtpPort;
export const getActiveMockToken = () => activeMockToken;

export const startMockServer = async (): Promise<{
  baseUrl: string;
  ftpPort?: number;
  token?: string;
}> => {
  if (activeMockBaseUrl)
    return { baseUrl: activeMockBaseUrl, ftpPort: activeFtpPort || undefined, token: activeMockToken || undefined };
  if (startPromise) return startPromise;

  startPromise = (async () => {
    try {
      const config = await loadMockConfigPayload();
      const response = await MockC64U.startServer({ config });
      activeMockBaseUrl = response.baseUrl;
      activeFtpPort = response.ftpPort ?? null;
      activeMockToken = response.token ?? null;
      return { baseUrl: response.baseUrl, ftpPort: response.ftpPort, token: response.token };
    } catch (error) {
      addErrorLog("Mock C64U server failed to start", {
        error: (error as Error).message,
      });
      throw error;
    } finally {
      startPromise = null;
    }
  })();

  return startPromise;
};

export const stopMockServer = async () => {
  if (!activeMockBaseUrl && !startPromise) {
    return;
  }

  try {
    if (startPromise) {
      await startPromise;
    }
    await MockC64U.stopServer();
  } catch (error) {
    addErrorLog("Mock C64U server failed to stop", {
      error: (error as Error).message,
    });
    throw error;
  } finally {
    activeMockBaseUrl = null;
    activeFtpPort = null;
    activeMockToken = null;
  }
};
