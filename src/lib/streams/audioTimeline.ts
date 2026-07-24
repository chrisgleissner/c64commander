/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Audio packet-loss concealment (PLC) timeline — a faithful TypeScript port of c64stream's
 * pure, OBS-free `c64-audio-timeline` (src/audio/c64-audio-timeline.{c,h}). Rather than reinvent
 * loss handling, we reuse the same battle-tested state machine that the C64 Ultimate OBS plugin
 * ships with.
 *
 * The device streams 16-bit stereo audio as fixed 192-frame (768-byte) packets tagged with a
 * 16-bit wrap-around sequence number. This maps that sequence onto a monotonic packet index and,
 * per packet, decides:
 *
 *   PLAY    the expected next packet (delta == +1) — emit as-is.
 *   DROP    a late/duplicate packet (delta <= 0 within the resync threshold) — discard, do NOT
 *           advance the index (advancing would shift A/V sync 4 ms per occurrence).
 *   CONCEAL a forward gap — synthesize the missing packets before playing the real one. The fill
 *           is hold-last-sample faded toward 0 (NEVER zeros: real SID output carries a DC offset,
 *           so a zero-fill against it is itself a click), with a short ramp into the next real
 *           packet so both splices are step-free. A/V sync is preserved: the index still advances
 *           by the true sequence delta.
 *   RESYNC  a gap beyond the fill cap, or a large backward jump (device restart) — re-anchor.
 */

/** Stereo frames per packet (fixed by the Ultimate spec). */
export const AUDIO_TIMELINE_FRAMES_PER_PACKET = 192;
/** Bytes per packet body (192 stereo frames × 4 bytes), no seq header. */
export const AUDIO_TIMELINE_PACKET_BYTES = 768;
/** Max packets synthesized per gap for the playback path (~100 ms). */
export const AUDIO_CONCEAL_MAX_PACKETS = 25;
/** Max gap (packets, ~5 s) still concealed rather than treated as a discontinuity. */
export const AUDIO_WAV_FILL_MAX_PACKETS = 1250;
/** Backward seq jump (packets, ~1 s) treated as a stream restart. */
export const AUDIO_RESYNC_THRESHOLD = 250;
/** The held value fades linearly to 0 over this many samples (~100 ms). */
export const AUDIO_CONCEAL_FADE_SAMPLES = AUDIO_CONCEAL_MAX_PACKETS * AUDIO_TIMELINE_FRAMES_PER_PACKET;
/** Final samples of the fill ramp linearly to the first real sample after the gap (~2.7 ms). */
export const AUDIO_CONCEAL_RAMP_SAMPLES = 128;

export type AudioSeqAction = "play" | "drop" | "conceal" | "resync";

export interface AudioTimelineStats {
  /** Gap packets, whether concealed or resynced over. */
  packetsLost: number;
  /** Gap packets covered by concealment fill. */
  concealed: number;
  /** delta < 0 within the resync threshold. */
  lateDropped: number;
  /** delta == 0. */
  duplicates: number;
  /** Timeline re-anchors. */
  resyncs: number;
}

export interface AudioTimelineResult {
  action: AudioSeqAction;
  /** Synthetic index at which the REAL packet plays (PLAY/CONCEAL/RESYNC). */
  index: number;
  /** On CONCEAL, the number of packets to synthesize before the real one. */
  gap: number;
}

/** Sign-extend the low 16 bits — handles the 16-bit sequence wraparound (65530 → 3 is +9). */
const int16 = (v: number): number => ((v & 0xffff) << 16) >> 16;

/** Endpoint samples for one concealment run (the real samples either side of the gap). */
export interface AudioConcealFill {
  lastLeft: number;
  lastRight: number;
  nextLeft: number;
  nextRight: number;
}

export class AudioTimeline {
  private seqSet = false;
  private lastSeq = 0;
  private packetIndex = 0;
  readonly stats: AudioTimelineStats = {
    packetsLost: 0,
    concealed: 0,
    lateDropped: 0,
    duplicates: 0,
    resyncs: 0,
  };

  reset(): void {
    this.seqSet = false;
    this.lastSeq = 0;
    this.packetIndex = 0;
    this.stats.packetsLost = 0;
    this.stats.concealed = 0;
    this.stats.lateDropped = 0;
    this.stats.duplicates = 0;
    this.stats.resyncs = 0;
  }

  /**
   * Advance the timeline with a packet's sequence number. `nowSlot` is an optional wall-clock
   * packet slot used only to re-anchor on RESYNC; pass 0 when playback schedules downstream.
   */
  advance(seq: number, nowSlot = 0): AudioTimelineResult {
    if (!this.seqSet) {
      this.seqSet = true;
      this.lastSeq = seq;
      this.packetIndex = 0;
      return { action: "play", index: 0, gap: 0 };
    }

    const delta = int16(seq - this.lastSeq);

    if (delta === 1) {
      this.packetIndex += 1;
      this.lastSeq = seq;
      return { action: "play", index: this.packetIndex, gap: 0 };
    }

    if (delta <= 0 && delta > -AUDIO_RESYNC_THRESHOLD) {
      // Duplicate or too-late packet: never play stale samples, never advance the timeline.
      if (delta === 0) this.stats.duplicates += 1;
      else this.stats.lateDropped += 1;
      return { action: "drop", index: this.packetIndex, gap: 0 };
    }

    if (delta > 1 && delta - 1 <= AUDIO_WAV_FILL_MAX_PACKETS) {
      const gap = delta - 1;
      this.stats.packetsLost += gap;
      this.stats.concealed += gap;
      this.packetIndex += delta;
      this.lastSeq = seq;
      return { action: "conceal", index: this.packetIndex, gap };
    }

    // Stream discontinuity: huge forward jump or big backward jump. Re-anchor monotonically.
    if (delta > 1) this.stats.packetsLost += delta - 1;
    this.stats.resyncs += 1;
    const nextIndex = Math.max(this.packetIndex + 1, nowSlot);
    this.packetIndex = nextIndex;
    this.lastSeq = seq;
    return { action: "resync", index: this.packetIndex, gap: 0 };
  }
}

/** Held value at global fill-sample position s: linear fade from `last` toward 0, then silence. */
const concealHeldValue = (last: number, s: number): number => {
  if (s >= AUDIO_CONCEAL_FADE_SAMPLES) return 0;
  return Math.trunc((last * (AUDIO_CONCEAL_FADE_SAMPLES - s)) / AUDIO_CONCEAL_FADE_SAMPLES);
};

/**
 * Synthesize concealment packet `k` of `n` (768 bytes, no seq header) into `out`. The fill holds
 * the last real sample, fades it toward 0, and ramps the final samples into the first real sample
 * of the packet after the gap — so both the entry and exit splices are step-free (below the
 * ~600-count click-detector limit). Ported verbatim from c64_audio_conceal_fill_packet.
 */
export const concealFillPacket = (
  fill: AudioConcealFill,
  k: number,
  n: number,
  out: Uint8Array = new Uint8Array(AUDIO_TIMELINE_PACKET_BYTES),
): Uint8Array => {
  if (n === 0 || k >= n) {
    out.fill(0);
    return out;
  }

  const frames = AUDIO_TIMELINE_FRAMES_PER_PACKET;
  const total = n * frames;
  const rampLen = total < AUDIO_CONCEAL_RAMP_SAMPLES ? total : AUDIO_CONCEAL_RAMP_SAMPLES;
  const rampStart = total - rampLen;

  for (let i = 0; i < frames; i++) {
    const s = k * frames + i;
    let left = concealHeldValue(fill.lastLeft, s);
    let right = concealHeldValue(fill.lastRight, s);

    if (s >= rampStart) {
      // Crossfade the held value into the first sample of the real packet after the gap.
      const pos = s - rampStart + 1;
      left += Math.trunc(((fill.nextLeft - left) * pos) / rampLen);
      right += Math.trunc(((fill.nextRight - right) * pos) / rampLen);
    }

    const l = left & 0xffff;
    const r = right & 0xffff;
    out[i * 4 + 0] = l & 0xff;
    out[i * 4 + 1] = (l >> 8) & 0xff;
    out[i * 4 + 2] = r & 0xff;
    out[i * 4 + 3] = (r >> 8) & 0xff;
  }
  return out;
};
