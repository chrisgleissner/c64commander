/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { bench, describe } from "vitest";
import { VicStreamAssembler, VIC_HEADER_BYTES, VIC_BYTES_PER_LINE, VIC_LAST_LINE_FLAG } from "@/lib/streams/vicStream";
import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";
import { AudioTimeline, concealFillPacket, AUDIO_TIMELINE_PACKET_BYTES } from "@/lib/streams/audioTimeline";
import { StreamGovernor } from "@/lib/streams/streamGovernor";
import { StreamTelemetry, type StreamTelemetrySample } from "@/lib/streams/streamTelemetry";

/**
 * Host microbenchmarks for the Live View streaming hot paths (spec §14.3). Reports ops/s per stage
 * so a dedicated runner can gate regressions against a committed baseline. Run:
 *   npx vitest bench tests/benchmarks/streamHotPaths.bench.ts --project unit-node --run
 */

// One PAL frame's worth of per-line VIC packets (68 packets: lines 0,4,…,268; last flags 0x8000).
const framePackets: Uint8Array[] = [];
for (let line = 0; line <= VIC_PAL_HEIGHT - 4; line += 4) {
  const p = new Uint8Array(VIC_HEADER_BYTES + VIC_BYTES_PER_LINE);
  const v = new DataView(p.buffer);
  const seq = line / 4;
  v.setUint16(0, seq, true);
  v.setUint16(2, 0, true);
  v.setUint16(4, line | (line >= VIC_PAL_HEIGHT - 4 ? VIC_LAST_LINE_FLAG : 0), true);
  v.setUint16(6, VIC_FRAME_WIDTH, true);
  p[8] = 4;
  p[9] = 4;
  framePackets.push(p);
}

const audioBody = new Uint8Array(AUDIO_TIMELINE_PACKET_BYTES).fill(0x20);
const concealFill = { lastLeft: 4000, lastRight: -3000, nextLeft: 1000, nextRight: 500 };
const outPacket = new Uint8Array(AUDIO_TIMELINE_PACKET_BYTES);

const baseSample = (t: number): StreamTelemetrySample => ({
  tMs: t,
  audioConcealed: 0,
  audioLostPackets: 0,
  audioBufferMs: 80,
  audioUnderruns: 0,
  videoPresented: t,
  videoDecimated: 0,
  videoBacklogReplacements: 0,
  videoFramesLost: 0,
  videoDroppedPackets: 0,
  renderResidenceMs: 5,
  fps: 50,
  effectiveFraction: 1,
  requestedMode: "auto",
});

describe("Live View streaming hot paths", () => {
  bench("VIC frame assembly (68 packets → 1 frame)", () => {
    const assembler = new VicStreamAssembler();
    for (const p of framePackets) assembler.ingest(p);
  });

  bench("audio PLC timeline advance (contiguous packet)", () => {
    const tl = new AudioTimeline();
    for (let i = 0; i < 250; i++) tl.advance(i & 0xffff);
  });

  bench("audio concealment fill (one 768-byte packet)", () => {
    concealFillPacket(concealFill, 0, 4, outPacket);
  });

  bench("governor tick", () => {
    const gov = new StreamGovernor("auto");
    for (let i = 0; i < 250; i++) gov.update({ audioBufferMs: 80, audioUnderruns: 0 }, i * 250);
  });

  bench("telemetry ingest (one 10 Hz sample)", () => {
    const telem = new StreamTelemetry();
    for (let i = 0; i < 100; i++) telem.record(baseSample(i * 100));
  });

  bench("audio bytesToInt16 of one packet", () => {
    const view = new DataView(audioBody.buffer);
    let acc = 0;
    for (let i = 0; i < AUDIO_TIMELINE_PACKET_BYTES; i += 2) acc += view.getInt16(i, true);
    if (acc === Number.MAX_SAFE_INTEGER) throw new Error("unreachable");
  });
});
