/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  AUDIO_HEADER_BYTES,
  VIDEO_HEADER_BYTES,
  computePacketStats,
  parseAudioPacket,
  parseVideoPacket,
  reconstructBestVideoFrame,
} from "./parser.js";
import type {
  AudioEnvelopePoint,
  AudioFeatures,
  AudioState,
  AudioStateWindow,
  StreamCapturePacket,
  VideoFeatures,
} from "./types.js";

const AUDIO_SAMPLE_RATE_PAL_HZ = 47982.8869;

export function analyzeAudioPackets(packets: StreamCapturePacket[]): AudioFeatures {
  const valid = packets.filter((p) => p.payload.length >= AUDIO_HEADER_BYTES);
  const parsed = valid.map((packet) => ({
    receivedAtMs: packet.receivedAtMs,
    parsed: parseAudioPacket(packet.payload),
  }));
  const sequences = parsed.map((packet) => packet.parsed.sequence);
  const stats = computePacketStats(sequences);

  const samples = flattenSamples(parsed.map((packet) => packet.parsed.samplePairs));
  const envelope = buildAudioEnvelope(parsed);
  const rms = computeRms(samples);
  const peakAbs = computePeakAbs(samples);
  const dominantFrequencyHz = estimateDominantFrequency(samples, AUDIO_SAMPLE_RATE_PAL_HZ);

  return {
    sampleRateHz: AUDIO_SAMPLE_RATE_PAL_HZ,
    rms,
    peakAbs,
    dominantFrequencyHz,
    samplePairs: samples.length / 2,
    envelope,
    stats,
  };
}

export function findFirstSustainedAudioState(
  envelope: readonly AudioEnvelopePoint[],
  options: {
    state: AudioState;
    thresholdRms: number;
    requiredDurationMs: number;
    afterMs?: number;
    maxGapMs?: number;
  },
): AudioStateWindow {
  const afterMs = options.afterMs ?? 0;
  const maxGapMs = options.maxGapMs ?? 30;
  let windowStartMs: number | null = null;
  let lastPacketEndMs: number | null = null;

  for (const point of envelope) {
    const packetStartMs = point.receivedAtMs;
    const packetEndMs = point.receivedAtMs + point.packetDurationMs;
    if (packetEndMs <= afterMs) {
      continue;
    }

    const matches = isAudioState(point.rms, options.thresholdRms, options.state);
    if (!matches) {
      windowStartMs = null;
      lastPacketEndMs = null;
      continue;
    }

    const effectiveStartMs = Math.max(packetStartMs, afterMs);
    if (windowStartMs === null || lastPacketEndMs === null || effectiveStartMs - lastPacketEndMs > maxGapMs) {
      windowStartMs = effectiveStartMs;
    }
    lastPacketEndMs = packetEndMs;

    if (packetEndMs - windowStartMs >= options.requiredDurationMs) {
      return {
        state: options.state,
        thresholdRms: options.thresholdRms,
        requiredDurationMs: options.requiredDurationMs,
        firstObservedAtMs: windowStartMs,
        settledAtMs: packetEndMs,
        endAtMs: packetEndMs,
      };
    }
  }

  return {
    state: options.state,
    thresholdRms: options.thresholdRms,
    requiredDurationMs: options.requiredDurationMs,
    firstObservedAtMs: null,
    settledAtMs: null,
    endAtMs: null,
  };
}

export function hasContinuousAudioState(
  envelope: readonly AudioEnvelopePoint[],
  options: {
    state: AudioState;
    thresholdRms: number;
    startMs: number;
    durationMs: number;
    maxGapMs?: number;
  },
): boolean {
  const maxGapMs = options.maxGapMs ?? 30;
  const endTargetMs = options.startMs + options.durationMs;
  let coveredUntilMs = options.startMs;

  for (const point of envelope) {
    const packetStartMs = point.receivedAtMs;
    const packetEndMs = point.receivedAtMs + point.packetDurationMs;
    if (packetEndMs <= options.startMs) {
      continue;
    }
    if (packetStartMs > coveredUntilMs + maxGapMs) {
      return false;
    }
    if (!isAudioState(point.rms, options.thresholdRms, options.state)) {
      return false;
    }
    coveredUntilMs = Math.max(coveredUntilMs, packetEndMs);
    if (coveredUntilMs >= endTargetMs) {
      return true;
    }
  }

  return false;
}

export function medianEnvelopeRms(
  envelope: readonly AudioEnvelopePoint[],
  options: { startMs?: number; endMs?: number } = {},
): number {
  const values = envelope
    .filter((point) => {
      const packetStartMs = point.receivedAtMs;
      const packetEndMs = point.receivedAtMs + point.packetDurationMs;
      if (options.startMs !== undefined && packetEndMs <= options.startMs) {
        return false;
      }
      if (options.endMs !== undefined && packetStartMs >= options.endMs) {
        return false;
      }
      return true;
    })
    .map((point) => point.rms)
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return 0;
  }
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle]!;
  }
  return (values[middle - 1]! + values[middle]!) / 2;
}

export function analyzeVideoPackets(packets: StreamCapturePacket[]): VideoFeatures {
  const valid = packets.filter((p) => p.payload.length >= VIDEO_HEADER_BYTES);
  const parsed = valid.map((packet) => parseVideoPacket(packet.payload));
  const sequences = parsed.map((packet) => packet.sequence);
  const stats = computePacketStats(sequences);

  const frame = reconstructBestVideoFrame(parsed);
  const borderHistogram = computeBorderHistogram(frame.pixels, frame.width, frame.height);
  const centerHistogram = computeCenterHistogram(frame.pixels, frame.width, frame.height);

  return {
    dominantBorderColor: argMax(borderHistogram),
    dominantBackgroundColor: argMax(centerHistogram),
    borderHistogram,
    centerHistogram,
    stats,
    frameCompleteness: frame.completeness,
  };
}

function flattenSamples(chunks: Int16Array[]): Int16Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function buildAudioEnvelope(
  packets: Array<{
    receivedAtMs: number;
    parsed: ReturnType<typeof parseAudioPacket>;
  }>,
): AudioEnvelopePoint[] {
  return packets.map(({ receivedAtMs, parsed }) => ({
    receivedAtMs,
    packetDurationMs: (parsed.samplePairs.length / 2 / AUDIO_SAMPLE_RATE_PAL_HZ) * 1000,
    rms: computeRms(parsed.samplePairs),
    peakAbs: computePeakAbs(parsed.samplePairs),
    samplePairs: parsed.samplePairs.length / 2,
  }));
}

function isAudioState(rms: number, thresholdRms: number, state: AudioState): boolean {
  return state === "silent" ? rms <= thresholdRms : rms > thresholdRms;
}

function computeRms(samples: Int16Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    sumSquares += x * x;
  }
  return Math.sqrt(sumSquares / samples.length) / 32768;
}

function computePeakAbs(samples: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]!);
    if (abs > peak) {
      peak = abs;
    }
  }
  return peak / 32768;
}

function estimateDominantFrequency(samplesInterleaved: Int16Array, sampleRateHz: number): number {
  const mono = extractLeftChannel(samplesInterleaved);
  if (mono.length < 64) {
    return 0;
  }

  const n = Math.min(2048, mono.length);
  const start = mono.length - n;
  let bestBin = 0;
  let bestPower = 0;

  for (let bin = 1; bin < n / 2; bin++) {
    let real = 0;
    let imag = 0;
    const w = (2 * Math.PI * bin) / n;
    for (let i = 0; i < n; i++) {
      const x = mono[start + i]! / 32768;
      const phase = w * i;
      real += x * Math.cos(phase);
      imag -= x * Math.sin(phase);
    }
    const power = real * real + imag * imag;
    if (power > bestPower) {
      bestPower = power;
      bestBin = bin;
    }
  }

  return (bestBin * sampleRateHz) / n;
}

function extractLeftChannel(samplesInterleaved: Int16Array): Int16Array {
  const length = Math.floor(samplesInterleaved.length / 2);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = samplesInterleaved[i * 2]!;
  }
  return out;
}

function computeBorderHistogram(pixels: Uint8Array, width: number, height: number): number[] {
  const hist = new Array<number>(16).fill(0);
  if (width === 0 || height === 0) {
    return hist;
  }

  const borderThicknessX = Math.max(8, Math.floor(width * 0.08));
  const borderThicknessY = Math.max(8, Math.floor(height * 0.08));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x < borderThicknessX ||
        x >= width - borderThicknessX ||
        y < borderThicknessY ||
        y >= height - borderThicknessY
      ) {
        const color = pixels[y * width + x]! & 0x0f;
        hist[color] += 1;
      }
    }
  }
  return hist;
}

function computeCenterHistogram(pixels: Uint8Array, width: number, height: number): number[] {
  const hist = new Array<number>(16).fill(0);
  if (width === 0 || height === 0) {
    return hist;
  }

  const left = Math.floor(width * 0.25);
  const right = Math.ceil(width * 0.75);
  const top = Math.floor(height * 0.25);
  const bottom = Math.ceil(height * 0.75);

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const color = pixels[y * width + x]! & 0x0f;
      hist[color] += 1;
    }
  }
  return hist;
}

function argMax(values: number[]): number {
  let bestIdx = 0;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (value > best) {
      best = value;
      bestIdx = i;
    }
  }
  return bestIdx;
}
