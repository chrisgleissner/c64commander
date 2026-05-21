import { describe, expect, it } from "vitest";
import {
  buildAudioEnvelope,
  buildAudioVolumeVerificationRow,
  medianEnvelopeRms,
} from "../../../tmp/playbackVolumeAudioOracle.mjs";

function createAudioPacket(samples: number[]): Buffer {
  const payload = Buffer.alloc(2 + samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    payload.writeInt16LE(samples[index]!, 2 + index * 2);
  }
  return payload;
}

describe("playbackVolumeAudioOracle", () => {
  it("builds an audio envelope with normalized RMS values", () => {
    const envelope = buildAudioEnvelope([
      {
        receivedAtMs: 0,
        payload: createAudioPacket([12000, 12000, 12000, 12000]),
      },
    ]);

    expect(envelope).toHaveLength(1);
    expect(envelope[0]!.rms).toBeGreaterThan(0.3);
    expect(envelope[0]!.samplePairs).toBe(2);
  });

  it("computes median RMS within the requested time window", () => {
    const envelope = [
      { receivedAtMs: 0, packetDurationMs: 10, rms: 0.1, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 20, packetDurationMs: 10, rms: 0.3, peakAbs: 0.3, samplePairs: 2 },
      { receivedAtMs: 40, packetDurationMs: 10, rms: 0.5, peakAbs: 0.5, samplePairs: 2 },
    ];

    expect(medianEnvelopeRms(envelope, { startMs: 10, endMs: 45 })).toBe(0.4);
  });

  it("verifies an audio increase when the post-action window has materially higher RMS", () => {
    const envelope = [
      { receivedAtMs: 0, packetDurationMs: 40, rms: 0.05, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 120, packetDurationMs: 40, rms: 0.05, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 360, packetDurationMs: 40, rms: 0.09, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 520, packetDurationMs: 40, rms: 0.11, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 700, packetDurationMs: 40, rms: 0.12, peakAbs: 0.1, samplePairs: 2 },
    ];

    const row = buildAudioVolumeVerificationRow({
      scenario: "V1",
      actionKind: "slider-drag",
      actionIssuedAtMs: 250,
      expectedDirection: "increase",
      committedIndex: 24,
      previousCommittedIndex: 12,
      envelope,
      beforeWindow: { startOffsetMs: -260, endOffsetMs: -40 },
      afterWindow: { startOffsetMs: 80, endOffsetMs: 520 },
      minDeltaRms: 0.02,
    });

    expect(row.result).toBe("VERIFIED");
    expect(row.steadyStateRmsAfter).toBeGreaterThan(row.steadyStateRmsBefore!);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("flags a direction mismatch when audio moves opposite to the requested slider change", () => {
    const envelope = [
      { receivedAtMs: 0, packetDurationMs: 40, rms: 0.12, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 120, packetDurationMs: 40, rms: 0.11, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 360, packetDurationMs: 40, rms: 0.14, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 520, packetDurationMs: 40, rms: 0.15, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 700, packetDurationMs: 40, rms: 0.16, peakAbs: 0.1, samplePairs: 2 },
    ];

    const row = buildAudioVolumeVerificationRow({
      scenario: "V1",
      actionKind: "slider-drag",
      actionIssuedAtMs: 250,
      expectedDirection: "decrease",
      committedIndex: 4,
      previousCommittedIndex: 20,
      envelope,
      beforeWindow: { startOffsetMs: -260, endOffsetMs: -40 },
      afterWindow: { startOffsetMs: 80, endOffsetMs: 520 },
      minDeltaRms: 0.02,
    });

    expect(row.result).toBe("DIRECTION_MISMATCH");
    expect(row.steadyStateRmsAfter).toBeGreaterThan(row.steadyStateRmsBefore!);
  });

  it("treats near-flat post-action RMS deltas as amplitude-insufficient rather than reversed", () => {
    const envelope = [
      { receivedAtMs: 0, packetDurationMs: 40, rms: 0.12, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 120, packetDurationMs: 40, rms: 0.119, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 360, packetDurationMs: 40, rms: 0.1185, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 520, packetDurationMs: 40, rms: 0.1192, peakAbs: 0.1, samplePairs: 2 },
      { receivedAtMs: 700, packetDurationMs: 40, rms: 0.1191, peakAbs: 0.1, samplePairs: 2 },
    ];

    const row = buildAudioVolumeVerificationRow({
      scenario: "V1",
      actionKind: "slider-drag",
      actionIssuedAtMs: 250,
      expectedDirection: "increase",
      committedIndex: 24,
      previousCommittedIndex: 12,
      envelope,
      beforeWindow: { startOffsetMs: -260, endOffsetMs: -40 },
      afterWindow: { startOffsetMs: 80, endOffsetMs: 520 },
      minDeltaRms: 0.02,
    });

    expect(row.result).toBe("AMPLITUDE_INSUFFICIENT");
    expect(Math.abs(row.rmsDeltaMagnitude ?? 0)).toBeLessThan(0.003);
  });
});
