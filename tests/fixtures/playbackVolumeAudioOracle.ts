type AudioPacket = {
  receivedAtMs: number;
  payload: Buffer;
};

type AudioEnvelopeRow = {
  receivedAtMs: number;
  packetDurationMs: number;
  rms: number;
  peakAbs: number;
  samplePairs: number;
};

type EnvelopeWindow = {
  startMs?: number;
  endMs?: number;
};

type VolumeVerificationInput = {
  scenario: string;
  actionKind: string;
  actionIssuedAtMs: number;
  expectedDirection: "increase" | "decrease";
  committedIndex: number;
  previousCommittedIndex: number;
  envelope: AudioEnvelopeRow[];
  beforeWindow: { startOffsetMs: number; endOffsetMs: number };
  afterWindow: { startOffsetMs: number; endOffsetMs: number };
  minDeltaRms: number;
};

type VolumeVerificationRow = {
  scenario: string;
  actionKind: string;
  result: "VERIFIED" | "DIRECTION_MISMATCH" | "AMPLITUDE_INSUFFICIENT" | "NO_AUDIO";
  steadyStateRmsBefore: number | null;
  steadyStateRmsAfter: number | null;
  latencyMs: number | null;
  rmsDeltaMagnitude: number | null;
  committedIndex: number;
  previousCommittedIndex: number;
};

const PCM_NORMALIZER = 32768;
const DEFAULT_PACKET_DURATION_MS = 20;

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
  }
  return sorted[midpoint]!;
};

const overlapsWindow = (row: AudioEnvelopeRow, window: Required<EnvelopeWindow>) => {
  const rowStart = row.receivedAtMs;
  const rowEnd = row.receivedAtMs + row.packetDurationMs;
  return rowEnd > window.startMs && rowStart < window.endMs;
};

export function buildAudioEnvelope(packets: AudioPacket[]): AudioEnvelopeRow[] {
  return packets.map(({ receivedAtMs, payload }) => {
    const sampleCount = Math.max(0, Math.floor((payload.length - 2) / 2));
    const samples = Array.from({ length: sampleCount }, (_value, index) => payload.readInt16LE(2 + index * 2));
    const normalized = samples.map((sample) => sample / PCM_NORMALIZER);
    const rms =
      normalized.length === 0
        ? 0
        : Math.sqrt(normalized.reduce((sum, sample) => sum + sample * sample, 0) / normalized.length);
    const peakAbs = normalized.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    return {
      receivedAtMs,
      packetDurationMs: DEFAULT_PACKET_DURATION_MS,
      rms,
      peakAbs,
      samplePairs: Math.floor(sampleCount / 2),
    };
  });
}

export function medianEnvelopeRms(envelope: AudioEnvelopeRow[], window: EnvelopeWindow = {}) {
  const boundedWindow = {
    startMs: window.startMs ?? Number.NEGATIVE_INFINITY,
    endMs: window.endMs ?? Number.POSITIVE_INFINITY,
  };
  return median(envelope.filter((row) => overlapsWindow(row, boundedWindow)).map((row) => row.rms));
}

export function buildAudioVolumeVerificationRow({
  scenario,
  actionKind,
  actionIssuedAtMs,
  expectedDirection,
  committedIndex,
  previousCommittedIndex,
  envelope,
  beforeWindow,
  afterWindow,
  minDeltaRms,
}: VolumeVerificationInput): VolumeVerificationRow {
  const beforeBounds = {
    startMs: actionIssuedAtMs + beforeWindow.startOffsetMs,
    endMs: actionIssuedAtMs + beforeWindow.endOffsetMs,
  };
  const afterBounds = {
    startMs: actionIssuedAtMs + afterWindow.startOffsetMs,
    endMs: actionIssuedAtMs + afterWindow.endOffsetMs,
  };
  const steadyStateRmsBefore = medianEnvelopeRms(envelope, beforeBounds);
  const steadyStateRmsAfter = medianEnvelopeRms(envelope, afterBounds);

  if (steadyStateRmsBefore === null || steadyStateRmsAfter === null) {
    return {
      scenario,
      actionKind,
      result: "NO_AUDIO",
      steadyStateRmsBefore,
      steadyStateRmsAfter,
      latencyMs: null,
      rmsDeltaMagnitude: null,
      committedIndex,
      previousCommittedIndex,
    };
  }

  const rmsDelta = steadyStateRmsAfter - steadyStateRmsBefore;
  const directionMatches = expectedDirection === "increase" ? rmsDelta > 0 : rmsDelta < 0;
  const latencyPacket = envelope.find((row) => {
    if (!overlapsWindow(row, afterBounds)) return false;
    return Math.abs(row.rms - steadyStateRmsBefore) >= minDeltaRms;
  });

  return {
    scenario,
    actionKind,
    result:
      Math.abs(rmsDelta) < minDeltaRms
        ? "AMPLITUDE_INSUFFICIENT"
        : directionMatches
          ? "VERIFIED"
          : "DIRECTION_MISMATCH",
    steadyStateRmsBefore,
    steadyStateRmsAfter,
    latencyMs: latencyPacket ? Math.max(0, latencyPacket.receivedAtMs - actionIssuedAtMs) : null,
    rmsDeltaMagnitude: rmsDelta,
    committedIndex,
    previousCommittedIndex,
  };
}
