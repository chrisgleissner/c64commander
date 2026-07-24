/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadSidRadioEnabled } from "@/lib/config/appSettings";
import { SidRadioWorkerClient } from "./sidRadioWorkerClient";
import type { SidRadioReadyStats } from "./sidRadioWorkerProtocol";

declare global {
  interface Window {
    __sidRadioProbe?: () => Promise<SidRadioReadyStats>;
    __sidRadioReady?: SidRadioReadyStats | { error: string };
  }
}

/**
 * M0.5 device harness. When SID Radio is enabled, expose `window.__sidRadioProbe()`
 * so the Pixel-4 HIL / CDP can spin up the Web Worker, fetch + parse the bundled
 * `.sidcorr` off the main thread, and read the ready stats — proving the
 * vite-worker → Capacitor-WebView path with `engineThreadIsMain === false` (G3).
 *
 * Importing this module also pulls `sidRadioWorkerClient` (and therefore the
 * `new Worker(new URL("./sidRadio.worker.ts", …))` pattern) into the build graph
 * so vite emits the worker chunk. It is a no-op at runtime with the flag off
 * (Prime Directive 7): the worker is never instantiated.
 */
export const registerSidRadioProbe = (): void => {
  if (typeof window === "undefined") return;
  if (!loadSidRadioEnabled()) return;
  window.__sidRadioProbe = async () => {
    const client = new SidRadioWorkerClient();
    try {
      const stats = await client.load();
      window.__sidRadioReady = stats;
      return stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.__sidRadioReady = { error: message };
      throw error;
    } finally {
      client.terminate();
    }
  };
};
