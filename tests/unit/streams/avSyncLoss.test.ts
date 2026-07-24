/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A/V sync robustness under packet loss.
 *
 * Synthesizes a realistic C64 Ultimate stream — periodic, precisely-aligned white-flash + tone
 * "pops" (as the bundled av-sync-auto program emits) — as raw VIC/audio UDP datagrams, drops 15%
 * of packets on BOTH streams, and drives them through the SHIPPED pipeline (VicStreamAssembler +
 * first-packet frame timestamping + the raw per-packet analyzer feed + AvSyncAnalyzer) exactly as
 * AvMirrorSession wires it. It then asserts:
 *
 *   1. The A/V sync offset holds (P99 |offset| < 30 ms) despite the loss — losing packets shifts
 *      a pop's detected time by at most a packet or two, never the tens of ms that a systematic
 *      pipeline skew would.
 *   2. No spurious pops are invented: exactly the intended flashes are detected, no more. A
 *      partial (loss-holed) frame stays below the white threshold, so dropped packets can only
 *      ever COST a pop, never manufacture one.
 */

import { describe, expect, it } from "vitest";
import { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { AvSyncAnalyzer } from "@/lib/streams/avSync";
import type { StreamReceiver, StreamReceiverOptions, StreamConnectionState } from "@/lib/streams/streamReceiver";
import type { AudioMirrorPlayer } from "@/lib/streams/audioPlayer";

// --- Deterministic PRNG (mulberry32) so a "15% loss" run is reproducible. ---
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// --- VIC / audio wire format (matches vicStream.ts / audioStream.ts) ---
const VIC_HEADER = 12;
const LINES_PER_PACKET = 4;
const WIDTH = 384;
const BYTES_PER_LINE = WIDTH / 2; // 192
const PAL_HEIGHT = 272;
const PACKETS_PER_FRAME = PAL_HEIGHT / LINES_PER_PACKET; // 68
const AUDIO_FRAMES_PER_PACKET = 192;

const vicPacket = (seq: number, frame: number, lineGroup: number, white: boolean): Uint8Array => {
  const line = lineGroup * LINES_PER_PACKET;
  const lastLine = lineGroup === PACKETS_PER_FRAME - 1;
  const pkt = new Uint8Array(VIC_HEADER + LINES_PER_PACKET * BYTES_PER_LINE);
  const view = new DataView(pkt.buffer);
  view.setUint16(0, seq & 0xffff, true);
  view.setUint16(2, frame & 0xffff, true);
  view.setUint16(4, (line & 0x7fff) | (lastLine ? 0x8000 : 0), true);
  view.setUint16(6, WIDTH, true);
  pkt[8] = LINES_PER_PACKET;
  pkt[9] = 4; // bits per pixel
  view.setUint16(10, 0, true); // encoding
  if (white) pkt.fill(0x11, VIC_HEADER); // both nibbles = white (index 1)
  return pkt;
};

const audioPacket = (seq: number, loud: boolean): Uint8Array => {
  const pkt = new Uint8Array(2 + AUDIO_FRAMES_PER_PACKET * 4);
  pkt[0] = seq & 0xff;
  pkt[1] = (seq >> 8) & 0xff;
  if (loud) {
    const view = new DataView(pkt.buffer, 2);
    for (let i = 0; i < AUDIO_FRAMES_PER_PACKET; i++) {
      view.setInt16(i * 4, 8000, true);
      view.setInt16(i * 4 + 2, 8000, true);
    }
  }
  return pkt;
};

interface WireEvent {
  stream: "audio" | "video";
  bytes: Uint8Array;
  arrivalMs: number;
}

/**
 * Build the full lossless event list for `pops` aligned flashes, apply a realistic jittery-WiFi
 * arrival model, then drop `lossRate` of packets.
 *
 * WiFi model: a SHARED, time-varying link latency (0–~42 ms, swinging like real congestion) that
 * affects BOTH streams together — audio and video traverse the same Wi-Fi hop from the same
 * device, so a lag spike hits both. This is precisely why A/V sync survives lag: the shared
 * latency cancels in the audio−video offset, leaving only a small INDEPENDENT per-packet jitter
 * (±4 ms). The independent component also reorders packets (arrival ≠ send order), exercising the
 * assembler's by-line writes and the analyzer's timestamp-based (not order-based) matching.
 */
const synthStream = (pops: number, cadenceFrames: number, rng: () => number, lossRate: number) => {
  const events: WireEvent[] = [];
  const framePeriodMs = 20; // PAL ~50 fps
  const audioPeriodMs = 4; // ~250 packets/s
  const totalFrames = (pops + 1) * cadenceFrames;

  // Correlated link latency (laggy + jittery) + independent per-packet jitter.
  const sharedLatency = (t: number) => Math.max(0, 20 + 14 * Math.sin(t / 137) + 8 * Math.sin(t / 41));
  const indieJitter = () => (rng() - 0.5) * 8; // ±4 ms, independent per packet
  const wire = (sendMs: number) => sendMs + sharedLatency(sendMs) + indieJitter();

  // Video: every `cadenceFrames`-th frame (after the first) is a one-frame white flash.
  let vidSeq = 0;
  const flashTimes: number[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const white = f > 0 && f % cadenceFrames === 0;
    const frameTimeMs = f * framePeriodMs;
    if (white) flashTimes.push(frameTimeMs);
    for (let lg = 0; lg < PACKETS_PER_FRAME; lg++) {
      const sendMs = frameTimeMs + (lg * framePeriodMs) / PACKETS_PER_FRAME;
      events.push({ stream: "video", bytes: vicPacket(vidSeq++, f, lg, white), arrivalMs: wire(sendMs) });
    }
  }

  // Audio: a loud tone burst for the one frame duration of each flash, silence otherwise.
  let audSeq = 0;
  const totalAudio = Math.ceil((totalFrames * framePeriodMs) / audioPeriodMs);
  for (let a = 0; a < totalAudio; a++) {
    const t = a * audioPeriodMs;
    const loud = flashTimes.some((ft) => t >= ft && t < ft + framePeriodMs);
    events.push({ stream: "audio", bytes: audioPacket(audSeq++, loud), arrivalMs: wire(t) });
  }

  events.sort((x, y) => x.arrivalMs - y.arrivalMs);
  // Independent packet loss on each stream.
  const kept = events.filter(() => rng() >= lossRate);
  return { kept, intendedPops: flashTimes.length };
};

class PushReceiver implements StreamReceiver {
  private handler: ((data: Uint8Array, arrivalMs: number) => void) | null = null;
  private stateHandler: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "239.0.1.64:11000";
  constructor(readonly name: "audio" | "video") {}
  onDatagram(h: (data: Uint8Array, arrivalMs: number) => void) {
    this.handler = h;
  }
  onStateChange(h: (s: StreamConnectionState) => void) {
    this.stateHandler = h;
    h("connecting");
  }
  ready() {
    this.stateHandler?.("open");
    return Promise.resolve();
  }
  close() {}
  push(bytes: Uint8Array, arrivalMs: number) {
    this.handler?.(bytes, arrivalMs);
  }
}

const fakePlayer = () =>
  ({
    start: async () => true,
    playChunk: () => {},
    stop: async () => {},
    get scheduledChunks() {
      return 0;
    },
  }) as unknown as AudioMirrorPlayer;

const runScenario = async (seed: number, lossRate: number) => {
  const audioRx = new PushReceiver("audio");
  const videoRx = new PushReceiver("video");
  const session = new AvMirrorSession({
    startStream: async () => ({}),
    stopStream: async () => ({}),
    createAudioReceiver: (_opts: StreamReceiverOptions) => audioRx,
    createVideoReceiver: (_opts: StreamReceiverOptions) => videoRx,
    createPlayer: fakePlayer,
  });

  const analyzer = new AvSyncAnalyzer();
  session.subscribeFrames((frame, _height, arrivalMs) => analyzer.pushVideoFrame(frame, arrivalMs));
  session.subscribeAudio((samples, arrivalMs) => analyzer.pushAudioSamples(samples, arrivalMs));

  await session.startVideo();
  await session.startAudio();

  const rng = mulberry32(seed);
  const { kept, intendedPops } = synthStream(40, 8, rng, lossRate);
  for (const ev of kept) {
    (ev.stream === "audio" ? audioRx : videoRx).push(ev.bytes, ev.arrivalMs);
  }
  return { stats: analyzer.getStats(), intendedPops };
};

describe("A/V sync under 15% UDP packet loss", () => {
  it("keeps the A/V offset P99 < 30 ms with 15% loss on both audio and video", async () => {
    for (const seed of [1, 7, 42, 1337]) {
      const { stats, intendedPops } = await runScenario(seed, 0.15);

      // Loss can COST a pop (e.g. dropping a flash frame's last-line packet delays that frame's
      // completion, so it is never measured) — but each pop that IS measured stays in sync. With
      // 15% loss ~70%+ of flashes still complete; the point is sync quality, not the sample count.
      expect(stats.count).toBeGreaterThanOrEqual(Math.floor(intendedPops * 0.65));
      // No spurious pops: never MORE detections than intended flashes. Dropped packets can only
      // hole a frame (keeping it below the white threshold), never manufacture a white flash.
      expect(stats.count).toBeLessThanOrEqual(intendedPops);

      // Every matched offset stays within ±30 ms — so P99 |offset| < 30 ms by construction.
      expect(stats.minMs).toBeGreaterThan(-30);
      expect(stats.maxMs).toBeLessThan(30);
      expect(Math.abs(stats.p99Ms as number)).toBeLessThan(30);

      // Unmatched pops are REAL orphans (a tone whose flash frame never completed, or vice
      // versa), never invented ones — so they are bounded by the pops that loss cost us. The
      // matcher still pairs each flash with its OWN tone (nearest within the window), so an
      // orphan never steals the next flash's partner and skews the offset.
      const missed = intendedPops - stats.count;
      expect(stats.unmatchedVideo + stats.unmatchedAudio).toBeLessThanOrEqual(missed + 3);
    }
  });

  it("is essentially perfect with no loss (sanity baseline)", async () => {
    const { stats, intendedPops } = await runScenario(3, 0);
    expect(stats.count).toBe(intendedPops);
    expect(stats.minMs).toBeGreaterThan(-15);
    expect(stats.maxMs).toBeLessThan(15);
  });
});
