/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability D — audio stream de-packetize + batching.
 *
 * Wire format (/v1/streams/audio, default UDP 11001):
 *   u16 seq (LE) | interleaved stereo S16LE samples …
 * 192 stereo frames per packet (768 bytes of PCM). Sample rate 47983 Hz. We batch
 * ~8 packets (~32 ms) before handing a chunk to the player, to bound latency
 * without per-packet overhead. seq gaps feed a dropped-packet health counter.
 */

export const AUDIO_SAMPLE_RATE = 47983;
export const AUDIO_SEQ_BYTES = 2;
export const AUDIO_STEREO_FRAME_BYTES = 4; // 2 channels * 2 bytes
export const AUDIO_FRAMES_PER_PACKET = 192;
export const AUDIO_BATCH_PACKETS = 8;

export interface ParsedAudioPacket {
  seq: number;
  /** Whole-stereo-frame PCM body (bytes), seq stripped. */
  body: Uint8Array;
}

/** Strip the 2-byte seq and return the PCM body trimmed to whole stereo frames. */
export const parseAudioPacket = (packet: Uint8Array): ParsedAudioPacket | null => {
  if (packet.length < AUDIO_SEQ_BYTES + AUDIO_STEREO_FRAME_BYTES) return null;
  const seq = packet[0] | (packet[1] << 8);
  const raw = packet.subarray(AUDIO_SEQ_BYTES);
  const usable = raw.length - (raw.length % AUDIO_STEREO_FRAME_BYTES);
  if (usable <= 0) return null;
  return { seq, body: raw.subarray(0, usable) };
};

/** Convert little-endian S16 bytes to a native Int16Array (platform-independent). */
export const bytesToInt16LE = (bytes: Uint8Array): Int16Array => {
  const count = bytes.length >> 1;
  const out = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i += 1) out[i] = view.getInt16(i * 2, true);
  return out;
};

export interface StereoFloatChunk {
  left: Float32Array;
  right: Float32Array;
  frames: number;
}

/** De-interleave interleaved stereo S16 into normalised [-1, 1) L/R float channels. */
export const deinterleaveStereo = (interleaved: Int16Array): StereoFloatChunk => {
  const frames = interleaved.length >> 1;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    left[i] = interleaved[2 * i] / 32768;
    right[i] = interleaved[2 * i + 1] / 32768;
  }
  return { left, right, frames };
};

export interface AudioBatcherStats {
  packets: number;
  ignored: number;
  droppedPackets: number;
  batches: number;
}

/**
 * Accumulates parsed audio packets and flushes an interleaved S16 chunk every
 * `batchPackets` packets (or on an explicit flush). Tracks seq gaps for health.
 */
export class AudioBatcher {
  private chunks: Uint8Array[] = [];
  private pending = 0;
  private lastSeq: number | null = null;
  readonly stats: AudioBatcherStats = { packets: 0, ignored: 0, droppedPackets: 0, batches: 0 };

  constructor(private readonly batchPackets: number = AUDIO_BATCH_PACKETS) {}

  push(packet: Uint8Array): Int16Array | null {
    const parsed = parseAudioPacket(packet);
    if (!parsed) {
      this.stats.ignored += 1;
      return null;
    }
    this.stats.packets += 1;
    if (this.lastSeq !== null) {
      const gap = (parsed.seq - this.lastSeq - 1) & 0xffff;
      if (gap > 0 && gap < 0x8000) this.stats.droppedPackets += gap;
    }
    this.lastSeq = parsed.seq;

    this.chunks.push(parsed.body);
    this.pending += 1;
    if (this.pending >= this.batchPackets) return this.flush();
    return null;
  }

  flush(): Int16Array | null {
    if (this.chunks.length === 0) return null;
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.pending = 0;
    this.stats.batches += 1;
    return bytesToInt16LE(merged);
  }

  reset(): void {
    this.chunks = [];
    this.pending = 0;
    this.lastSeq = null;
    this.stats.packets = 0;
    this.stats.ignored = 0;
    this.stats.droppedPackets = 0;
    this.stats.batches = 0;
  }
}
