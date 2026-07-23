/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Audio network / jitter buffer for the Live View player path — the reorder + delay half of
 * c64stream's `c64-network-buffer`, married to the `AudioTimeline` loss concealment.
 *
 * Received audio packets are held for a configurable delay (default 5 ms, see
 * `loadStreamNetworkBufferMs`) and released in sequence order. A slightly-late or reordered
 * packet still lands in order; a genuine gap is known in time to be concealed (hold-last-sample
 * with fade) rather than producing an audible click. Emitted bodies are ordered, gap-free,
 * seq-stripped 768-byte PCM — ready for the batcher → player.
 *
 * The analyzer never sees this path: it measures the raw received stream so concealment fill can
 * never be mistaken for a tone pop.
 *
 * Lightweight by construction: the queue holds ~1–2 packets at 5 ms, insertion is a short linear
 * scan, and release is driven by the wire clock (no timer) — a real packet flushes older ones.
 * `drainAll()` empties the tail on stop. Concealment (rare) is the only allocation.
 */

import {
  AUDIO_CONCEAL_MAX_PACKETS,
  AUDIO_TIMELINE_PACKET_BYTES,
  AudioTimeline,
  concealFillPacket,
  type AudioConcealFill,
  type AudioTimelineStats,
} from "./audioTimeline";

export interface AudioPlaybackBufferDeps {
  /** Ordered, concealed, seq-stripped 768-byte PCM bodies for the player. */
  emit: (pcmBody: Uint8Array) => void;
  /** Buffer depth in ms (default 5). 0 = release immediately (lowest latency). */
  delayMs?: number;
}

interface QueuedPacket {
  seq: number;
  body: Uint8Array;
  arrivalMs: number;
}

/** Sign-extend the low 16 bits for wrap-aware sequence ordering. */
const int16 = (v: number): number => ((v & 0xffff) << 16) >> 16;

const readInt16LE = (bytes: Uint8Array, offset: number): number => {
  const v = bytes[offset] | (bytes[offset + 1] << 8);
  return (v << 16) >> 16;
};

export class AudioPlaybackBuffer {
  private readonly queue: QueuedPacket[] = [];
  private readonly timeline = new AudioTimeline();
  private readonly delayMs: number;
  private readonly emit: (pcmBody: Uint8Array) => void;
  private clockMs = 0;
  // Last emitted real sample — the concealment entry point (never zero: SID output is DC-biased).
  private lastLeft = 0;
  private lastRight = 0;
  // Hard cap so a persistently-missing sequence can't grow the queue without bound.
  private readonly maxQueue: number;

  constructor(deps: AudioPlaybackBufferDeps) {
    this.emit = deps.emit;
    this.delayMs = Math.max(0, deps.delayMs ?? 5);
    // ~4 ms per packet; keep a couple of buffer-depths of headroom for a burst.
    this.maxQueue = Math.ceil(this.delayMs / 4) + 8;
  }

  get stats(): AudioTimelineStats {
    return this.timeline.stats;
  }

  /** Ingest one parsed audio packet (seq + 768-byte body) with its wire-arrival timestamp. */
  push(seq: number, body: Uint8Array, arrivalMs: number): void {
    if (arrivalMs > this.clockMs) this.clockMs = arrivalMs;

    // Insert maintaining ascending wrap-aware sequence order (buffer is tiny → linear scan).
    let i = this.queue.length;
    while (i > 0 && int16(this.queue[i - 1].seq - seq) > 0) i--;
    this.queue.splice(i, 0, { seq, body, arrivalMs });

    this.drainDue();
    // Safety valve: never let the queue exceed the cap (a lost low seq must not stall playback).
    while (this.queue.length > this.maxQueue) this.release(this.queue.shift()!);
  }

  /** Release every packet held longer than the buffer delay, in sequence order. */
  private drainDue(): void {
    while (this.queue.length > 0 && this.clockMs - this.queue[0].arrivalMs >= this.delayMs) {
      this.release(this.queue.shift()!);
    }
  }

  /** Flush all buffered packets immediately (call on stop so the tail is not stranded). */
  drainAll(): void {
    while (this.queue.length > 0) this.release(this.queue.shift()!);
  }

  private release(packet: QueuedPacket): void {
    const result = this.timeline.advance(packet.seq);
    if (result.action === "drop") return;

    if (result.action === "conceal" && result.gap > 0) {
      const fill: AudioConcealFill = {
        lastLeft: this.lastLeft,
        lastRight: this.lastRight,
        nextLeft: readInt16LE(packet.body, 0),
        nextRight: readInt16LE(packet.body, 2),
      };
      const count = Math.min(result.gap, AUDIO_CONCEAL_MAX_PACKETS);
      for (let k = 0; k < count; k++) {
        this.emit(concealFillPacket(fill, k, result.gap));
      }
    }

    this.emit(packet.body);
    if (packet.body.length >= AUDIO_TIMELINE_PACKET_BYTES) {
      this.lastLeft = readInt16LE(packet.body, AUDIO_TIMELINE_PACKET_BYTES - 4);
      this.lastRight = readInt16LE(packet.body, AUDIO_TIMELINE_PACKET_BYTES - 2);
    }
  }

  reset(): void {
    this.queue.length = 0;
    this.timeline.reset();
    this.clockMs = 0;
    this.lastLeft = 0;
    this.lastRight = 0;
  }
}
