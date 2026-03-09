/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AudioPacket, PacketStats, VideoFrame, VideoPacket } from "./types.js";

export const VIDEO_HEADER_BYTES = 12;
export const AUDIO_HEADER_BYTES = 2;

export function parseAudioPacket(payload: Buffer): AudioPacket {
  if (payload.length < AUDIO_HEADER_BYTES) {
    throw new Error(`Audio packet too small: ${payload.length}`);
  }

  const sequence = payload.readUInt16LE(0);
  const audioBytes = payload.subarray(AUDIO_HEADER_BYTES);
  if (audioBytes.length % 2 !== 0) {
    throw new Error(`Audio payload has odd byte count: ${audioBytes.length}`);
  }

  const samplePairs = new Int16Array(audioBytes.length / 2);
  for (let i = 0; i < samplePairs.length; i++) {
    samplePairs[i] = audioBytes.readInt16LE(i * 2);
  }

  return { sequence, samplePairs };
}

export function parseVideoPacket(payload: Buffer): VideoPacket {
  if (payload.length < VIDEO_HEADER_BYTES) {
    throw new Error(`Video packet too small: ${payload.length}`);
  }

  const sequence = payload.readUInt16LE(0);
  const frameNumber = payload.readUInt16LE(2);
  const lineField = payload.readUInt16LE(4);
  const lineNumber = lineField & 0x7fff;
  const isLastPacket = (lineField & 0x8000) !== 0;
  const pixelsPerLine = payload.readUInt16LE(6);
  const linesPerPacket = payload.readUInt8(8);
  const bitsPerPixel = payload.readUInt8(9);
  const encodingType = payload.readUInt16LE(10);

  return {
    sequence,
    frameNumber,
    lineNumber,
    isLastPacket,
    pixelsPerLine,
    linesPerPacket,
    bitsPerPixel,
    encodingType,
    payload: payload.subarray(VIDEO_HEADER_BYTES),
  };
}

export function computePacketStats(sequences: number[]): PacketStats {
  if (sequences.length === 0) {
    return {
      packetCount: 0,
      sequenceStart: 0,
      sequenceEnd: 0,
      expectedPackets: 0,
      droppedPackets: 0,
      outOfOrderPackets: 0,
    };
  }

  const start = Math.min(...sequences);
  const end = Math.max(...sequences);
  const unique = new Set(sequences);

  let outOfOrder = 0;
  for (let i = 1; i < sequences.length; i++) {
    if (sequences[i]! < sequences[i - 1]!) {
      outOfOrder += 1;
    }
  }

  const expected = end - start + 1;
  const dropped = Math.max(0, expected - unique.size);

  return {
    packetCount: sequences.length,
    sequenceStart: start,
    sequenceEnd: end,
    expectedPackets: expected,
    droppedPackets: dropped,
    outOfOrderPackets: outOfOrder,
  };
}

export function reconstructBestVideoFrame(packets: VideoPacket[]): VideoFrame {
  if (packets.length === 0) {
    throw new Error("No video packets available");
  }

  const byFrame = new Map<number, VideoPacket[]>();
  for (const packet of packets) {
    const framePackets = byFrame.get(packet.frameNumber) ?? [];
    framePackets.push(packet);
    byFrame.set(packet.frameNumber, framePackets);
  }

  let selected: VideoPacket[] | undefined;
  for (const framePackets of byFrame.values()) {
    if (!selected || framePackets.length > selected.length) {
      selected = framePackets;
    }
  }
  if (!selected) {
    throw new Error("Failed to select frame packets");
  }

  const reference = selected[0]!;
  const width = reference.pixelsPerLine;
  const linesPerPacket = reference.linesPerPacket;
  const bytesPerLine = Math.ceil((width * reference.bitsPerPixel) / 8);

  const maxLine = Math.max(...selected.map((packet) => packet.lineNumber + linesPerPacket));
  const height = maxLine;
  const frame = new Uint8Array(width * height);
  const filledLines = new Set<number>();

  for (const packet of selected) {
    const expectedPayloadBytes = bytesPerLine * linesPerPacket;
    const packetPayload = packet.payload.subarray(0, expectedPayloadBytes);
    for (let lineOffset = 0; lineOffset < linesPerPacket; lineOffset++) {
      const lineIndex = packet.lineNumber + lineOffset;
      if (lineIndex >= height) {
        continue;
      }
      const srcStart = lineOffset * bytesPerLine;
      const srcLine = packetPayload.subarray(srcStart, srcStart + bytesPerLine);
      unpack4BitPixelsToRow(srcLine, frame, lineIndex * width, width);
      filledLines.add(lineIndex);
    }
  }

  const completeness = height === 0 ? 0 : filledLines.size / height;

  return {
    frameNumber: reference.frameNumber,
    width,
    height,
    pixels: frame,
    completeness,
  };
}

function unpack4BitPixelsToRow(srcLine: Uint8Array, dstPixels: Uint8Array, dstOffset: number, width: number): void {
  let cursor = dstOffset;
  for (let i = 0; i < srcLine.length && cursor < dstOffset + width; i++) {
    const packed = srcLine[i]!;
    const low = packed & 0x0f;
    const high = (packed >> 4) & 0x0f;

    dstPixels[cursor++] = low;
    if (cursor < dstOffset + width) {
      dstPixels[cursor++] = high;
    }
  }
}
