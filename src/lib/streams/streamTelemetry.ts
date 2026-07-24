/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Bounded Live View telemetry accumulator (spec §6, §12.2, §13).
 *
 * Ingests low-rate (~2–5 Hz) **cumulative** samples from the audio + video controllers, the audio
 * player and the governor, and maintains:
 *   - a bounded ring of **one-second buckets** (downsampled rates/aggregates, never raw per-item
 *     data) for the historical charts;
 *   - **session totals** and rolling **p50/p95/p99** over a bounded residence reservoir;
 *   - min/max extremes and lifecycle markers.
 *
 * Everything is bounded by construction: {@link MAX_BUCKETS} one-second buckets (~15 min) and a
 * {@link RESIDENCE_RESERVOIR} residence-sample ring. Ingest is O(1) amortised; the windowed views
 * and export are computed on demand (only when Stats is open) so streaming cost is unchanged
 * whether Stats is open or closed (§12.3).
 *
 * Metric conventions (§13): counters in a *sample* are CUMULATIVE session totals; the accumulator
 * diffs consecutive samples to derive per-second rates. Durations are milliseconds on a monotonic
 * clock. `audioBufferMs` / `renderResidenceMs` are INSTANTANEOUS; bucket fields are ROLLING
 * (per-second); session fields are SESSION-WIDE.
 */

/** ~15 minutes of one-second buckets. */
export const MAX_BUCKETS = 900;
/** Bounded residence-sample ring for session percentiles. */
export const RESIDENCE_RESERVOIR = 4096;

export interface StreamTelemetrySample {
  /** Monotonic presentation clock (ms). */
  tMs: number;
  /** Cumulative audio packets whose loss was concealed (from the PLC timeline). */
  audioConcealed: number;
  /** Cumulative audio packets detected lost (gap in sequence). */
  audioLostPackets: number;
  /** Instantaneous WebAudio player buffer depth ahead of the audio clock (ms). */
  audioBufferMs: number;
  /** Cumulative player underruns (output ran dry). */
  audioUnderruns: number;
  /** Cumulative frames presented (rendered). */
  videoPresented: number;
  /** Cumulative frames intentionally decimated by the cadence divisor. */
  videoDecimated: number;
  /** Cumulative renderer-backlog replacements (superseded before presentation). */
  videoBacklogReplacements: number;
  /** Cumulative frames lost on the wire (last-line packet never arrived). */
  videoFramesLost: number;
  /** Cumulative video packets dropped (sequence gaps). */
  videoDroppedPackets: number;
  /** Instantaneous last present-queue residence (ms). */
  renderResidenceMs: number;
  /** Instantaneous presented fps. */
  fps: number;
  /** Governor effective cadence divisor (1/2/4). */
  effectiveDivisor: number;
  /** Requested user frame-rate mode. */
  requestedMode: string;
}

/** One downsampled second of history (rates are per-second; levels are last/aggregate in the second). */
export interface TelemetryBucket {
  /** Bucket second index (floor(tMs/1000)). */
  sec: number;
  fpsAvg: number;
  audioBufferMsMin: number;
  audioBufferMsAvg: number;
  concealedPerSec: number;
  audioLostPerSec: number;
  presentedPerSec: number;
  decimatedPerSec: number;
  backlogPerSec: number;
  framesLostPerSec: number;
  videoDroppedPerSec: number;
  residenceMaxMs: number;
  underrunsInSec: number;
  effectiveDivisor: number;
}

export interface TelemetryPercentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface TelemetrySessionSummary {
  durationMs: number;
  samples: number;
  audioUnderruns: number;
  audioConcealed: number;
  audioLostPackets: number;
  audioBufferMsMin: number;
  videoPresented: number;
  videoDecimated: number;
  videoBacklogReplacements: number;
  videoFramesLost: number;
  videoDroppedPackets: number;
  residence: TelemetryPercentiles;
  fpsMax: number;
}

/** Nearest-rank-with-interpolation percentile over an ascending array. */
const percentile = (sortedAsc: number[], p: number): number => {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
};

const percentiles = (values: number[]): TelemetryPercentiles => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
};

/** Working aggregate for the second currently being filled. */
interface BucketAccumulator {
  sec: number;
  fpsSum: number;
  fpsCount: number;
  audioBufferMin: number;
  audioBufferSum: number;
  audioBufferCount: number;
  residenceMax: number;
  underrunsAtStart: number;
  underruns: number;
  // Cumulative counters captured at the FIRST sample of the second (for per-second deltas).
  firstConcealed: number;
  firstAudioLost: number;
  firstPresented: number;
  firstDecimated: number;
  firstBacklog: number;
  firstFramesLost: number;
  firstVideoDropped: number;
  lastConcealed: number;
  lastAudioLost: number;
  lastPresented: number;
  lastDecimated: number;
  lastBacklog: number;
  lastFramesLost: number;
  lastVideoDropped: number;
  effectiveDivisor: number;
}

export class StreamTelemetry {
  private readonly buckets: TelemetryBucket[] = [];
  private current: BucketAccumulator | null = null;
  private readonly residence: number[] = [];
  private residenceHead = 0;
  private startMs: number | null = null;
  private lastMs = 0;
  private samples = 0;
  private last: StreamTelemetrySample | null = null;
  private audioBufferMsMin = Infinity;
  private fpsMax = 0;

  /** Ingest one low-rate sample. O(1) amortised; closes a bucket when the second rolls over. */
  record(sample: StreamTelemetrySample): void {
    if (this.startMs === null) this.startMs = sample.tMs;
    this.last = sample;
    this.lastMs = sample.tMs;
    this.samples += 1;
    this.audioBufferMsMin = Math.min(this.audioBufferMsMin, sample.audioBufferMs);
    this.fpsMax = Math.max(this.fpsMax, sample.fps);

    // Bounded residence reservoir (ring) for session percentiles.
    if (this.residence.length < RESIDENCE_RESERVOIR) this.residence.push(sample.renderResidenceMs);
    else {
      this.residence[this.residenceHead] = sample.renderResidenceMs;
      this.residenceHead = (this.residenceHead + 1) % RESIDENCE_RESERVOIR;
    }

    const sec = Math.floor(sample.tMs / 1000);
    if (!this.current || this.current.sec !== sec) {
      if (this.current) this.closeBucket(this.current);
      this.current = this.openBucket(sec, sample);
    }
    this.fillBucket(this.current, sample);
  }

  private openBucket(sec: number, s: StreamTelemetrySample): BucketAccumulator {
    return {
      sec,
      fpsSum: 0,
      fpsCount: 0,
      audioBufferMin: Infinity,
      audioBufferSum: 0,
      audioBufferCount: 0,
      residenceMax: 0,
      underrunsAtStart: s.audioUnderruns,
      underruns: 0,
      firstConcealed: s.audioConcealed,
      firstAudioLost: s.audioLostPackets,
      firstPresented: s.videoPresented,
      firstDecimated: s.videoDecimated,
      firstBacklog: s.videoBacklogReplacements,
      firstFramesLost: s.videoFramesLost,
      firstVideoDropped: s.videoDroppedPackets,
      lastConcealed: s.audioConcealed,
      lastAudioLost: s.audioLostPackets,
      lastPresented: s.videoPresented,
      lastDecimated: s.videoDecimated,
      lastBacklog: s.videoBacklogReplacements,
      lastFramesLost: s.videoFramesLost,
      lastVideoDropped: s.videoDroppedPackets,
      effectiveDivisor: s.effectiveDivisor,
    };
  }

  private fillBucket(b: BucketAccumulator, s: StreamTelemetrySample): void {
    b.fpsSum += s.fps;
    b.fpsCount += 1;
    b.audioBufferMin = Math.min(b.audioBufferMin, s.audioBufferMs);
    b.audioBufferSum += s.audioBufferMs;
    b.audioBufferCount += 1;
    b.residenceMax = Math.max(b.residenceMax, s.renderResidenceMs);
    b.underruns = Math.max(0, s.audioUnderruns - b.underrunsAtStart);
    b.lastConcealed = s.audioConcealed;
    b.lastAudioLost = s.audioLostPackets;
    b.lastPresented = s.videoPresented;
    b.lastDecimated = s.videoDecimated;
    b.lastBacklog = s.videoBacklogReplacements;
    b.lastFramesLost = s.videoFramesLost;
    b.lastVideoDropped = s.videoDroppedPackets;
    b.effectiveDivisor = s.effectiveDivisor;
  }

  private closeBucket(b: BucketAccumulator): void {
    const bucket: TelemetryBucket = {
      sec: b.sec,
      fpsAvg: b.fpsCount ? b.fpsSum / b.fpsCount : 0,
      audioBufferMsMin: b.audioBufferMin === Infinity ? 0 : b.audioBufferMin,
      audioBufferMsAvg: b.audioBufferCount ? b.audioBufferSum / b.audioBufferCount : 0,
      concealedPerSec: b.lastConcealed - b.firstConcealed,
      audioLostPerSec: b.lastAudioLost - b.firstAudioLost,
      presentedPerSec: b.lastPresented - b.firstPresented,
      decimatedPerSec: b.lastDecimated - b.firstDecimated,
      backlogPerSec: b.lastBacklog - b.firstBacklog,
      framesLostPerSec: b.lastFramesLost - b.firstFramesLost,
      videoDroppedPerSec: b.lastVideoDropped - b.firstVideoDropped,
      residenceMaxMs: b.residenceMax,
      underrunsInSec: b.underruns,
      effectiveDivisor: b.effectiveDivisor,
    };
    this.buckets.push(bucket);
    while (this.buckets.length > MAX_BUCKETS) this.buckets.shift();
  }

  /** History buckets within the last `windowSec` seconds (Stats view). Closes the open bucket first. */
  buffersWindow(windowSec: number): TelemetryBucket[] {
    const closed = [...this.buckets];
    if (this.current) closed.push(this.snapshotOpenBucket(this.current));
    if (closed.length === 0) return [];
    const latest = closed[closed.length - 1].sec;
    const cutoff = latest - windowSec;
    return closed.filter((b) => b.sec > cutoff);
  }

  private snapshotOpenBucket(b: BucketAccumulator): TelemetryBucket {
    return {
      sec: b.sec,
      fpsAvg: b.fpsCount ? b.fpsSum / b.fpsCount : 0,
      audioBufferMsMin: b.audioBufferMin === Infinity ? 0 : b.audioBufferMin,
      audioBufferMsAvg: b.audioBufferCount ? b.audioBufferSum / b.audioBufferCount : 0,
      concealedPerSec: b.lastConcealed - b.firstConcealed,
      audioLostPerSec: b.lastAudioLost - b.firstAudioLost,
      presentedPerSec: b.lastPresented - b.firstPresented,
      decimatedPerSec: b.lastDecimated - b.firstDecimated,
      backlogPerSec: b.lastBacklog - b.firstBacklog,
      framesLostPerSec: b.lastFramesLost - b.firstFramesLost,
      videoDroppedPerSec: b.lastVideoDropped - b.firstVideoDropped,
      residenceMaxMs: b.residenceMax,
      underrunsInSec: b.underruns,
      effectiveDivisor: b.effectiveDivisor,
    };
  }

  /**
   * Session-wide summary (totals, extremes, residence percentiles). Counters are cumulative from 0
   * at session start (the controllers + this accumulator reset together), so the session total is
   * simply the LAST cumulative value — not a first→last delta, which would lose anything counted
   * before the first recorded tick.
   */
  summary(): TelemetrySessionSummary {
    const l = this.last;
    const total = (key: keyof StreamTelemetrySample): number => (l ? (l[key] as number) : 0);
    return {
      durationMs: this.startMs === null ? 0 : this.lastMs - this.startMs,
      samples: this.samples,
      audioUnderruns: total("audioUnderruns"),
      audioConcealed: total("audioConcealed"),
      audioLostPackets: total("audioLostPackets"),
      audioBufferMsMin: this.audioBufferMsMin === Infinity ? 0 : this.audioBufferMsMin,
      videoPresented: total("videoPresented"),
      videoDecimated: total("videoDecimated"),
      videoBacklogReplacements: total("videoBacklogReplacements"),
      videoFramesLost: total("videoFramesLost"),
      videoDroppedPackets: total("videoDroppedPackets"),
      residence: percentiles(this.residence),
      fpsMax: this.fpsMax,
    };
  }

  /** Diagnostic export payload (§12.4). Caller adds version/device/settings + limitations. */
  export(meta: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...meta,
      summary: this.summary(),
      buckets: this.buffersWindow(MAX_BUCKETS),
      metricConventions: {
        counters: "sample counters are cumulative; buckets show per-second deltas",
        durations: "milliseconds on a monotonic clock",
        residence: "present-queue residence: frame ready → presented",
      },
    };
  }

  reset(): void {
    this.buckets.length = 0;
    this.current = null;
    this.residence.length = 0;
    this.residenceHead = 0;
    this.startMs = null;
    this.lastMs = 0;
    this.samples = 0;
    this.last = null;
    this.audioBufferMsMin = Infinity;
    this.fpsMax = 0;
  }
}
