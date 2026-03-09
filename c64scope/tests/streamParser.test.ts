/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  computePacketStats,
  parseAudioPacket,
  parseVideoPacket,
  reconstructBestVideoFrame,
} from "../src/stream/parser.js";

describe("stream parser", () => {
  it("rejects undersized or malformed packets", () => {
    expect(() => parseAudioPacket(Buffer.alloc(1))).toThrow(/Audio packet too small/);

    const oddAudio = Buffer.alloc(5);
    oddAudio.writeUInt16LE(1, 0);
    expect(() => parseAudioPacket(oddAudio)).toThrow(/odd byte count/);

    expect(() => parseVideoPacket(Buffer.alloc(11))).toThrow(/Video packet too small/);
  });

  it("handles empty packet stats and missing video frames", () => {
    expect(computePacketStats([])).toEqual({
      packetCount: 0,
      sequenceStart: 0,
      sequenceEnd: 0,
      expectedPackets: 0,
      droppedPackets: 0,
      outOfOrderPackets: 0,
    });

    expect(() => reconstructBestVideoFrame([])).toThrow(/No video packets available/);
  });

  it("reconstructs partial frames with cropped payload rows", () => {
    const payload = Buffer.alloc(12 + 2);
    payload.writeUInt16LE(1, 0);
    payload.writeUInt16LE(7, 2);
    payload.writeUInt16LE(0x8000, 4);
    payload.writeUInt16LE(4, 6);
    payload.writeUInt8(2, 8);
    payload.writeUInt8(4, 9);
    payload.writeUInt16LE(0, 10);
    payload[12] = 0x12;
    payload[13] = 0x34;

    const frame = reconstructBestVideoFrame([parseVideoPacket(payload)]);
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(2);
    expect(frame.completeness).toBe(1);
    expect([...frame.pixels.slice(0, 4)]).toEqual([2, 1, 4, 3]);
  });
});
