/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type StreamType = "audio" | "video";

export interface AudioPacket {
  sequence: number;
  samplePairs: Int16Array;
}

export interface VideoPacket {
  sequence: number;
  frameNumber: number;
  lineNumber: number;
  isLastPacket: boolean;
  pixelsPerLine: number;
  linesPerPacket: number;
  bitsPerPixel: number;
  encodingType: number;
  payload: Uint8Array;
}

export interface PacketStats {
  packetCount: number;
  sequenceStart: number;
  sequenceEnd: number;
  expectedPackets: number;
  droppedPackets: number;
  outOfOrderPackets: number;
}

export interface AudioEnvelopePoint {
  receivedAtMs: number;
  packetDurationMs: number;
  rms: number;
  peakAbs: number;
  samplePairs: number;
}

export type AudioState = "active" | "silent";

export interface AudioStateWindow {
  state: AudioState;
  thresholdRms: number;
  requiredDurationMs: number;
  firstObservedAtMs: number | null;
  settledAtMs: number | null;
  endAtMs: number | null;
}

export interface AudioFeatures {
  sampleRateHz: number;
  rms: number;
  peakAbs: number;
  dominantFrequencyHz: number;
  samplePairs: number;
  envelope: AudioEnvelopePoint[];
  stats: PacketStats;
}

export interface VideoFrame {
  frameNumber: number;
  width: number;
  height: number;
  pixels: Uint8Array;
  completeness: number;
}

export interface VideoFeatures {
  dominantBorderColor: number;
  dominantBackgroundColor: number;
  borderHistogram: number[];
  centerHistogram: number[];
  stats: PacketStats;
  frameCompleteness: number;
}

export interface StreamCapturePacket {
  receivedAtMs: number;
  payload: Buffer;
}

export interface StreamCaptureResult {
  streamType: StreamType;
  durationMs: number;
  bindAddress: string;
  bindPort: number;
  destination: string;
  packets: StreamCapturePacket[];
}
