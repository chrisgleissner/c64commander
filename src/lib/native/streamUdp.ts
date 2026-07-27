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
  /** Base64 of the whole 52224-byte 4bpp VIC frame; EMPTY when `present` is false (decimated). */
  data: string;
  /** Wire-arrival timestamp (ms) of the frame's EARLIEST packet — the frame-start instant for A/V sync. */
  t?: number;
  /** Frame height in lines derived from the last packet (PAL 272 / NTSC 240). */
  height: number;
  /** Cumulative dropped-packet count (sequence gaps) observed on the socket so far. */
  dropped: number;
  /** Cumulative frames LOST (gaps in the frame-number sequence — a frame that never completed). */
  lost: number;
  /**
   * Whether this frame is presented at the current native keep-rate (see {@link StreamUdpPlugin.setKeepFraction}).
   * When false the frame was decimated natively: `data` is empty (its Base64 encode + bridge payload
   * were elided to save CPU), but the event is still delivered so JS can count it. Absent (treated as
   * true) on plugin builds without native decimation.
   */
  present?: boolean;
}

/** Live buffer/underrun stats returned by each {@link StreamUdpPlugin.writeAudioTrack} write. */
export interface StreamUdpAudioStats {
  /** PCM still queued ahead of the AudioTrack playback head (ms) — the native player buffer depth. */
  bufferedMs: number;
  /** Cumulative AudioTrack underruns (output ran dry) since {@link StreamUdpPlugin.openAudioTrack}. */
  underruns: number;
  /**
   * PCM bytes the AudioTrack refused because its buffer was full — audio the listener lost.
   *
   * Separate from {@link underruns}, which counts the opposite failure (the buffer running dry).
   * A stream can break up audibly with zero underruns if it is losing tails here instead, which is
   * exactly why this is reported rather than dropped silently.
   */
  droppedBytes?: number;
  /** What the AudioTrack is actually doing (not what was requested). */
  trackSampleRate?: number;
  trackChannels?: number;
  trackBufferFrames?: number;
  /**
   * Distinct source IPs seen on the audio group. More than one means another machine is streaming
   * into it uninvited — see `streams/foreignSenderGuard`.
   */
  senders?: string[];
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
  /**
   * Set the native keep-rate for an assembled video stream, in permille (0–1000; 1000 = present
   * every frame). The assembler decimates natively — skipping the Base64 encode + bridge of frames
   * that will not be presented — so the governor's frame-rate reduction actually saves CPU.
   */
  setKeepFraction(options: { name: string; permille: number }): Promise<void>;
  /**
   * Open a native low-latency audio sink (Android `AudioTrack`, `PERFORMANCE_MODE_LOW_LATENCY`) for
   * interleaved stereo S16LE PCM at `sampleRate` Hz. Replaces the WebAudio player's ~80 ms lead-in
   * with the AudioTrack's small fast-mixer buffer. All jitter buffering / concealment / batching stay
   * in JS; this sink only plays already-decided PCM. Idempotent: re-opening closes the previous track.
   */
  openAudioTrack(options: { sampleRate: number }): Promise<{ sampleRate: number; bufferMs: number }>;
  /**
   * Legacy JS-fed path: queue one chunk of base64 interleaved-stereo-S16LE PCM to the open AudioTrack.
   * The shipping path feeds the track natively from the receive thread (no bridge traffic); this
   * remains for completeness/testing. No-op (zeroed stats) if no track is open.
   */
  writeAudioTrack(options: { data: string }): Promise<StreamUdpAudioStats>;
  /**
   * Read the open AudioTrack's live buffer depth + underrun count — the governor's audio-headroom
   * signal, polled periodically since native (not JS) now drives playback. Zeroed if no track is open.
   */
  readAudioStats(options?: Record<string, never>): Promise<StreamUdpAudioStats>;
  /** Stop + release the native audio sink. Safe to call when none is open. */
  closeAudioTrack(options?: Record<string, never>): Promise<void>;
  addListener(eventName: "datagram", listener: (event: StreamUdpDatagramEvent) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: "videoframe",
    listener: (event: StreamUdpVideoFrameEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const StreamUdp = registerPlugin<StreamUdpPlugin>("StreamUdp");
