/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { AvMirrorSession, type AvStatsSnapshot } from "@/lib/streams/avMirrorSession";
import type { StreamConnectionState, StreamReceiver } from "@/lib/streams/streamReceiver";
import type { AudioMirrorPlayer } from "@/lib/streams/audioPlayer";
import { VIC_HEADER_BYTES, VIC_BYTES_PER_LINE, VIC_LAST_LINE_FLAG } from "@/lib/streams/vicStream";
import { VIC_FRAME_WIDTH } from "@/lib/streams/vicDecode";

/** A fake receiver that can be driven open and fed datagrams. */
class FakeReceiver implements StreamReceiver {
  datagram: ((data: Uint8Array, arrivalMs: number) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  destination = "239.0.1.64:11000";
  onDatagram(h: (d: Uint8Array, t: number) => void) {
    this.datagram = h;
  }
  onStateChange(h: (s: StreamConnectionState) => void) {
    this.stateCb = h;
  }
  ready() {
    return Promise.resolve();
  }
  close() {}
  open() {
    this.stateCb?.("open");
  }
  emit(bytes: Uint8Array, t: number) {
    this.datagram?.(bytes, t);
  }
}

/** A fake WebAudio player whose buffer depth / underrun count the test controls. */
class FakePlayer {
  bufferedMs = 100;
  underrunCount = 0;
  scheduled = 0;
  async start() {
    return true;
  }
  async stop() {}
  playChunk() {
    this.scheduled += 1;
  }
  get scheduledChunks() {
    return this.scheduled;
  }
}

const videoFrame = (seq: number, frame: number): Uint8Array => {
  const packet = new Uint8Array(VIC_HEADER_BYTES + VIC_BYTES_PER_LINE);
  const view = new DataView(packet.buffer);
  view.setUint16(0, seq & 0xffff, true);
  view.setUint16(2, frame & 0xffff, true);
  view.setUint16(4, (0 & 0x7fff) | VIC_LAST_LINE_FLAG, true);
  view.setUint16(6, VIC_FRAME_WIDTH, true);
  packet[8] = 4;
  packet[9] = 4;
  return packet;
};

const makeSession = () => {
  const audioReceiver = new FakeReceiver();
  const videoReceiver = new FakeReceiver();
  const player = new FakePlayer();
  const session = new AvMirrorSession({
    startStream: vi.fn(async () => ({})),
    stopStream: vi.fn(async () => ({})),
    createAudioReceiver: () => audioReceiver,
    createVideoReceiver: () => videoReceiver,
    createPlayer: () => player as unknown as AudioMirrorPlayer,
    now: () => 0,
  });
  return { session, audioReceiver, videoReceiver, player };
};

describe("AvMirrorSession — governor + telemetry wiring", () => {
  it("setFrameRateMode caps the effective divisor and surfaces it in the Stats snapshot", () => {
    const { session } = makeSession();
    session.setFrameRateMode("25", 0);
    const stats = session.getStatsSnapshot();
    expect(stats.governor.requested).toBe("25");
    expect(stats.governor.effectiveDivisor).toBe(4);
    expect(stats.governor.ceilingDivisor).toBe(4);
  });

  it("tick() demotes the video divisor when the player reports an underrun, and records telemetry", async () => {
    const { session, audioReceiver, videoReceiver, player } = makeSession();
    await session.startAudio();
    audioReceiver.open();
    await session.startVideo();
    videoReceiver.open();

    // A couple of frames present so the video snapshot has real counters.
    videoReceiver.emit(videoFrame(0, 0), 0);
    videoReceiver.emit(videoFrame(1, 1), 0);

    // Healthy first tick: no demote.
    session.tick(0);
    expect(session.getStatsSnapshot().governor.effectiveDivisor).toBe(1);

    // The player now reports an underrun → the next tick must demote video to protect audio.
    player.underrunCount = 1;
    session.tick(100);
    const stats = session.getStatsSnapshot();
    expect(stats.governor.effectiveDivisor).toBe(2);
    expect(stats.governor.reason).toContain("underrun");
    expect(stats.summary.videoPresented).toBeGreaterThan(0);
  });

  it("broadcasts Stats snapshots to subscribers on tick", async () => {
    const { session, videoReceiver } = makeSession();
    await session.startVideo();
    videoReceiver.open();
    const seen: AvStatsSnapshot[] = [];
    const unsub = session.subscribeStats((s) => seen.push(s));
    expect(seen).toHaveLength(1); // replay on subscribe
    session.tick(0);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    unsub();
    session.tick(100);
    expect(seen).toHaveLength(2); // no delivery after unsubscribe
  });

  it("exportDiagnostics produces a JSON-serialisable payload with governor + summary", async () => {
    const { session, videoReceiver } = makeSession();
    await session.startVideo();
    videoReceiver.open();
    videoReceiver.emit(videoFrame(0, 0), 0);
    session.tick(0);
    const payload = session.exportDiagnostics({ appVersion: "0.8.8" });
    expect(payload.appVersion).toBe("0.8.8");
    expect(payload).toHaveProperty("governor");
    expect(payload).toHaveProperty("summary");
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it("clears telemetry + governor pressure when a fresh session begins after a full stop", async () => {
    const { session, videoReceiver, player } = makeSession();
    await session.startVideo();
    videoReceiver.open();
    player.underrunCount = 3;
    session.tick(0); // demotes
    expect(session.getStatsSnapshot().governor.effectiveDivisor).toBe(2);
    await session.stopAll();

    // A new session resets governor pressure (mode preserved) and telemetry counters.
    await session.startVideo();
    videoReceiver.open();
    const stats = session.getStatsSnapshot();
    expect(stats.governor.effectiveDivisor).toBe(1);
    expect(stats.summary.videoPresented).toBe(0);
  });
});
