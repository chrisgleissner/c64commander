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
 * A fully-assembled VIC video frame, emitted by the native plugin when `bind({assemble:true})` is
 * used (the Live View fast path). Assembling frames natively collapses ~68 per-packet bridge hops
 * per frame into ONE — the per-event bridge overhead was what capped the mirror at ~20–30 fps.
 */
export interface StreamUdpVideoFrameEvent {
  name: string;
  /** Base64 of the whole 52224-byte 4bpp VIC frame (PAL-sized storage; NTSC is a subset). */
  data: string;
  /** Wire-arrival timestamp (ms) of the frame's EARLIEST packet — the frame-start instant for A/V sync. */
  t?: number;
  /** Frame height in lines derived from the last packet (PAL 272 / NTSC 240). */
  height: number;
  /** Cumulative dropped-packet count (sequence gaps) observed on the socket so far. */
  dropped: number;
  /** Cumulative frames LOST (gaps in the frame-number sequence — a frame that never completed). */
  lost: number;
}

/**
 * Native UDP receiver bridge (Android `StreamUdpPlugin`). Only used on native platforms —
 * the web/Docker build receives streams through the server's UDP -> WebSocket bridge instead.
 */
export interface StreamUdpPlugin {
  /**
   * `group` (optional) joins a multicast group on the bound port. `assemble` (video only) makes
   * the plugin reassemble VIC datagrams into whole frames natively and emit `videoframe` events
   * instead of per-packet `datagram` events.
   */
  bind(options: { name: string; port: number; group?: string; assemble?: boolean }): Promise<StreamUdpBindResult>;
  close(options: { name: string }): Promise<void>;
  addListener(eventName: "datagram", listener: (event: StreamUdpDatagramEvent) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: "videoframe",
    listener: (event: StreamUdpVideoFrameEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const StreamUdp = registerPlugin<StreamUdpPlugin>("StreamUdp");
