/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  analyzeAudioPackets,
  analyzeVideoPackets,
  findFirstSustainedAudioState,
  medianEnvelopeRms,
} from "../src/stream/analysis.js";
import {
  computePacketStats,
  parseAudioPacket,
  parseVideoPacket,
  reconstructBestVideoFrame,
} from "../src/stream/parser.js";
import type { StreamCapturePacket } from "../src/stream/types.js";

describe("stream pipeline", () => {
  it("decodes audio packets and extracts signal features", () => {
    const packets = buildAudioCapturePackets(440, 12);

    const first = parseAudioPacket(packets[0]!.payload);
    expect(first.sequence).toBe(1);
    expect(first.samplePairs.length).toBe(384);

    const features = analyzeAudioPackets(packets);
    expect(features.stats.packetCount).toBe(12);
    expect(features.stats.droppedPackets).toBe(0);
    expect(features.rms).toBeGreaterThan(0.01);
    expect(features.dominantFrequencyHz).toBeGreaterThan(300);
    expect(features.dominantFrequencyHz).toBeLessThan(600);
    expect(features.envelope).toHaveLength(12);
    expect(features.envelope[0]?.packetDurationMs).toBeGreaterThan(0);
  });

  it("detects sustained silent and active windows from the audio envelope", () => {
    const packets = [
      ...buildAudioCapturePackets(440, 30),
      ...buildSilentAudioCapturePackets(30, 120),
      ...buildAudioCapturePackets(440, 60, 150),
    ];

    const features = analyzeAudioPackets(packets);
    const preMuteMedian = medianEnvelopeRms(features.envelope, { endMs: 90 });
    expect(preMuteMedian).toBeGreaterThan(0.01);

    const silentWindow = findFirstSustainedAudioState(features.envelope, {
      state: "silent",
      thresholdRms: 0.001,
      requiredDurationMs: 120,
      afterMs: 100,
    });
    expect(silentWindow.firstObservedAtMs).not.toBeNull();
    expect(silentWindow.settledAtMs).not.toBeNull();

    const activeWindow = findFirstSustainedAudioState(features.envelope, {
      state: "active",
      thresholdRms: 0.01,
      requiredDurationMs: 120,
      afterMs: silentWindow.settledAtMs ?? 0,
    });
    expect(activeWindow.firstObservedAtMs).not.toBeNull();
    expect((silentWindow.settledAtMs ?? 0) - (silentWindow.firstObservedAtMs ?? 0)).toBeGreaterThanOrEqual(120);
    expect((activeWindow.settledAtMs ?? 0) - (activeWindow.firstObservedAtMs ?? 0)).toBeGreaterThanOrEqual(120);
  });

  it("reconstructs video frame and detects border/background color signature", () => {
    const packets = buildVideoCapturePackets(32, 20, 2, 6);

    const first = parseVideoPacket(packets[0]!.payload);
    expect(first.pixelsPerLine).toBe(32);
    expect(first.linesPerPacket).toBe(4);

    const decoded = packets.map((packet) => parseVideoPacket(packet.payload));
    const frame = reconstructBestVideoFrame(decoded);
    expect(frame.width).toBe(32);
    expect(frame.height).toBe(20);
    expect(frame.completeness).toBe(1);

    const features = analyzeVideoPackets(packets);
    expect(features.dominantBorderColor).toBe(2);
    expect(features.dominantBackgroundColor).toBe(6);
    expect(features.frameCompleteness).toBe(1);
  });

  it("tracks out-of-order and dropped packets for ordering/loss tolerance", () => {
    const stats = computePacketStats([10, 11, 13, 12, 15]);
    expect(stats.packetCount).toBe(5);
    expect(stats.expectedPackets).toBe(6);
    expect(stats.droppedPackets).toBe(1);
    expect(stats.outOfOrderPackets).toBe(1);

    const packets = buildVideoCapturePackets(32, 20, 2, 6);
    const withLoss = packets.filter((_, idx) => idx !== 2);
    const features = analyzeVideoPackets(withLoss);
    expect(features.stats.droppedPackets).toBeGreaterThanOrEqual(1);
    expect(features.frameCompleteness).toBeLessThan(1);
  });
});

function buildAudioCapturePackets(
  freqHz: number,
  packetCount: number,
  startPacketIndex: number = 0,
): StreamCapturePacket[] {
  const sampleRate = 47982.8869;
  const samplesPerPacketStereo = 192;
  const out: StreamCapturePacket[] = [];

  let globalIndex = 0;
  for (let packet = 0; packet < packetCount; packet++) {
    const payload = Buffer.alloc(2 + samplesPerPacketStereo * 4);
    payload.writeUInt16LE(startPacketIndex + packet + 1, 0);

    for (let i = 0; i < samplesPerPacketStereo; i++) {
      const t = globalIndex / sampleRate;
      const value = Math.round(Math.sin(2 * Math.PI * freqHz * t) * 8000);
      const base = 2 + i * 4;
      payload.writeInt16LE(value, base);
      payload.writeInt16LE(value, base + 2);
      globalIndex += 1;
    }

    out.push({ receivedAtMs: (startPacketIndex + packet) * 4, payload });
  }

  return out;
}

function buildSilentAudioCapturePackets(startPacketIndex: number, packetCount: number): StreamCapturePacket[] {
  const samplesPerPacketStereo = 192;
  const out: StreamCapturePacket[] = [];

  for (let packet = 0; packet < packetCount; packet++) {
    const payload = Buffer.alloc(2 + samplesPerPacketStereo * 4);
    payload.writeUInt16LE(startPacketIndex + packet + 1, 0);
    out.push({ receivedAtMs: (startPacketIndex + packet) * 4, payload });
  }

  return out;
}

function buildVideoCapturePackets(
  width: number,
  height: number,
  borderColor: number,
  backgroundColor: number,
): StreamCapturePacket[] {
  const linesPerPacket = 4;
  const bytesPerLine = width / 2;
  const packets: StreamCapturePacket[] = [];

  const framePixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      framePixels[y * width + x] = border ? borderColor : backgroundColor;
    }
  }

  let seq = 100;
  for (let line = 0; line < height; line += linesPerPacket) {
    const payload = Buffer.alloc(12 + linesPerPacket * bytesPerLine);
    payload.writeUInt16LE(seq++, 0);
    payload.writeUInt16LE(7, 2);
    const isLast = line + linesPerPacket >= height;
    payload.writeUInt16LE((isLast ? 0x8000 : 0) | line, 4);
    payload.writeUInt16LE(width, 6);
    payload.writeUInt8(linesPerPacket, 8);
    payload.writeUInt8(4, 9);
    payload.writeUInt16LE(0, 10);

    for (let lineOffset = 0; lineOffset < linesPerPacket; lineOffset++) {
      const y = line + lineOffset;
      for (let x = 0; x < width; x += 2) {
        const p0 = framePixels[y * width + x]! & 0x0f;
        const p1 = framePixels[y * width + x + 1]! & 0x0f;
        payload[12 + lineOffset * bytesPerLine + x / 2] = p0 | (p1 << 4);
      }
    }

    packets.push({ receivedAtMs: seq, payload });
  }

  return packets;
}
