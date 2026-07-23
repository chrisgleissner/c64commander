/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** Result of binding a UDP port natively: the phone's site-local IPv4 + the bound port. */
export interface StreamUdpBindResult {
  localIp: string;
  port: number;
}

/** A received datagram, delivered base64-encoded so it survives the JS bridge. */
export interface StreamUdpDatagramEvent {
  name: string;
  data: string;
  /**
   * Monotonic wire-arrival timestamp (ms, `System.nanoTime`-based) captured natively the instant
   * the datagram was read off the socket — before base64 encoding or the bridge hop. The A/V sync
   * analyzer uses this so the asymmetric downstream latency of the video (frame assembly + decode)
   * vs audio pipeline cannot skew the measured offset. Absent only on very old plugin builds.
   */
  t?: number;
}

/**
 * Native UDP receiver bridge (Android `StreamUdpPlugin`). Only used on native platforms —
 * the web/Docker build receives streams through the server's UDP -> WebSocket bridge instead.
 */
export interface StreamUdpPlugin {
  /** `group` (optional) joins a multicast group on the bound port. */
  bind(options: { name: string; port: number; group?: string }): Promise<StreamUdpBindResult>;
  close(options: { name: string }): Promise<void>;
  addListener(eventName: "datagram", listener: (event: StreamUdpDatagramEvent) => void): Promise<PluginListenerHandle>;
}

export const StreamUdp = registerPlugin<StreamUdpPlugin>("StreamUdp");
