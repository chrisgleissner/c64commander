/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { LocalSidWorkerLike } from "../localSidEngine";
import { NativeRendererChannel } from "./nativeRendererChannel";
import { SidplayEzRendererCore } from "./sidplayEzRendererCore";
import { sidRendererRuntime, type SidRendererId } from "./sidRendererAvailability";
import { ensureSidAudioAttached } from "./sidAudioAttach";

/** What the channel is for: background roles render at a lower thread priority. */
export type RendererRole = "playback" | "prerender" | "warm";

export type RendererChannelFactory = (renderer: SidRendererId, role: RendererRole) => LocalSidWorkerLike;

export class LocalSidUnavailableError extends Error {
  constructor(message = "Local SID engine requires Web Workers and Web Audio") {
    super(message);
    this.name = "LocalSidUnavailableError";
  }
}

/**
 * One channel per renderer and role. The two WASM renderers share a worker type — the worker loads
 * whichever artifact each `open` names — so switching between them keeps the worker; libSidplayEZ
 * gets a native renderer of its own.
 */
export const defaultRendererChannelFactory: RendererChannelFactory = (renderer, role) => {
  if (sidRendererRuntime(renderer) === "native") {
    return new NativeRendererChannel(
      new SidplayEzRendererCore({ background: role !== "playback", beforeCreate: ensureSidAudioAttached }),
    );
  }
  if (typeof Worker === "undefined") throw new LocalSidUnavailableError();
  // Vite compiles this into a module-worker chunk for both the web build and the Capacitor WebView.
  return new Worker(new URL("../localSid.worker.ts", import.meta.url), { type: "module" });
};
