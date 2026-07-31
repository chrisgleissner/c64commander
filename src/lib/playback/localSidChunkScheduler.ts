/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Gapless chunk scheduler for the Local SID engine's v1 Web Audio sink (spec
 * §12.2, D6 default). The worker renders interleaved `Int16` PCM chunks; this
 * schedules each one back-to-back on a Web Audio timeline so playback is
 * seamless, and accounts underruns (a chunk that arrives after the previously
 * scheduled audio has already finished — i.e. an audible gap).
 *
 * Kept deliberately narrow and host-deterministic: it depends only on the
 * {@link AudioScheduleSink} interface (a thin slice of `AudioContext`), so the
 * gapless math and underrun accounting are unit-tested with a fake clock — no
 * real audio hardware, no WASM. The real adapter lives in `localSidEngine.ts`.
 */

import { addLog } from "@/lib/logging";

/** A minimal audio buffer — the channel-planar float sink. */
export interface AudioScheduleBuffer {
  getChannelData(channel: number): Float32Array;
}

/** A one-shot buffer source scheduled at an absolute context time. */
export interface AudioScheduleSource {
  start(when: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

/** The slice of `AudioContext` the scheduler needs (host-injectable). */
export interface AudioScheduleSink {
  /** Monotonic audio clock in seconds. */
  readonly currentTime: number;
  /** Output sample rate in Hz. */
  readonly sampleRate: number;
  /** Allocate a planar buffer of `frames` per channel. */
  createBuffer(channels: number, frames: number, sampleRate: number): AudioScheduleBuffer;
  /** Create a source bound to `buffer`, connected to the destination. */
  createSource(buffer: AudioScheduleBuffer): AudioScheduleSource;
}

/** Int16 full-scale — divisor to normalise to Web Audio's [-1, 1] floats. */
const INT16_SCALE = 32768;

export interface LocalSidChunkSchedulerOptions {
  /**
   * Lead time before the first chunk starts, absorbing render/post latency so
   * the very first schedule does not itself count as an underrun. Seconds.
   */
  startPaddingSec?: number;
  /**
   * Fired when a scheduled source finishes playing (after cleanup). The engine
   * uses this as a clock-driven "buffer drained by one chunk" signal to pull
   * the next chunk from the worker — no polling interval needed.
   */
  onSourceEnded?: () => void;
}

export interface SchedulerStats {
  /** Chunks scheduled so far. */
  chunksScheduled: number;
  /** Audible gaps: a chunk scheduled after prior audio already ran out. */
  underruns: number;
  /** Seconds of audio still scheduled ahead of the clock (>= 0). */
  bufferedSeconds: number;
  /** Total seconds of audio scheduled across the session. */
  scheduledSeconds: number;
}

export class LocalSidChunkScheduler {
  private readonly startPaddingSec: number;
  private readonly onSourceEnded?: () => void;
  /** Absolute context time the next chunk should start at (0 = not started). */
  private nextStartTime = 0;
  /** Context time the first chunk started at (for position reporting). */
  private firstStartTime = 0;
  private started = false;
  private chunksScheduled = 0;
  /**
   * Chunks scheduled since the last {@link resetTo}, which is what "has this tune finished playing"
   * has to be measured against.
   *
   * The engine decides a tune is over when every source it scheduled has reported back. It counts
   * those reports itself and zeroes the count on a seek — but `chunksScheduled` is a session total
   * that a seek deliberately does not reset, so after one seek the two could never meet again.
   * Measured on a Pixel 4: a tune seeked into ran to the end of its audio with 114 scheduled against
   * 28 reported, never fired "ended", and the playlist sat on a silent track. A seek also silences
   * the sources still in flight, and those have their `onended` removed, so they can never report —
   * which is why this counts from the reset rather than subtracting.
   */
  private chunksSinceReset = 0;
  private underruns = 0;
  private scheduledSeconds = 0;
  /**
   * Playback position of the next sample the scheduler will emit.
   *
   * Zero for normal playback, where position is simply "how long we have been
   * playing". After a seek it carries the position we jumped to, so the reported
   * position continues from there instead of restarting at zero.
   */
  private positionOffsetSeconds = 0;
  private readonly live = new Set<AudioScheduleSource>();

  constructor(
    private readonly sink: AudioScheduleSink,
    options: LocalSidChunkSchedulerOptions = {},
  ) {
    this.startPaddingSec = Math.max(0, options.startPaddingSec ?? 0.15);
    this.onSourceEnded = options.onSourceEnded;
  }

  /**
   * Schedule one interleaved Int16 chunk gaplessly after the previous one.
   * Returns the absolute context time the chunk is scheduled to finish.
   */
  schedule(pcm: Int16Array, channels: number): number {
    const chans = Math.max(1, channels);
    const frames = Math.floor(pcm.length / chans);
    if (frames <= 0) return this.nextStartTime;

    const { currentTime, sampleRate } = this.sink;
    if (!this.started) {
      this.nextStartTime = currentTime + this.startPaddingSec;
      this.firstStartTime = this.nextStartTime;
      this.started = true;
    } else if (this.nextStartTime < currentTime) {
      // The previously scheduled audio already ran out before this chunk was
      // ready: an audible gap. Count it and resync to "now".
      this.underruns += 1;
      this.nextStartTime = currentTime;
    }

    const buffer = this.sink.createBuffer(chans, frames, sampleRate);
    // Deinterleave Int16 → planar Float32 in [-1, 1).
    for (let c = 0; c < chans; c += 1) {
      const out = buffer.getChannelData(c);
      for (let f = 0; f < frames; f += 1) {
        out[f] = pcm[f * chans + c] / INT16_SCALE;
      }
    }

    const source = this.sink.createSource(buffer);
    const startAt = this.nextStartTime;
    source.onended = () => {
      this.live.delete(source);
      this.onSourceEnded?.();
    };
    this.live.add(source);
    source.start(startAt);

    const duration = frames / sampleRate;
    this.nextStartTime = startAt + duration;
    this.scheduledSeconds += duration;
    this.chunksScheduled += 1;
    this.chunksSinceReset += 1;
    return this.nextStartTime;
  }

  /** Seconds of audio scheduled beyond the current clock (drives prefetch). */
  bufferedSeconds(): number {
    if (!this.started) return 0;
    return Math.max(0, this.nextStartTime - this.sink.currentTime);
  }

  /** Elapsed playback position in seconds, clamped to what was scheduled. */
  positionSeconds(): number {
    if (!this.started) return this.positionOffsetSeconds;
    const elapsed = this.sink.currentTime - this.firstStartTime;
    if (elapsed <= 0) return this.positionOffsetSeconds;
    return this.positionOffsetSeconds + Math.min(elapsed, this.scheduledSeconds);
  }

  getStats(): SchedulerStats {
    return {
      chunksScheduled: this.chunksScheduled,
      underruns: this.underruns,
      bufferedSeconds: this.bufferedSeconds(),
      scheduledSeconds: this.scheduledSeconds,
    };
  }

  /** True once at least one chunk has been scheduled. */
  hasStarted(): boolean {
    return this.started;
  }

  /** Chunks scheduled since the last seek; see {@link chunksSinceReset}. */
  chunksScheduledSinceReset(): number {
    return this.chunksSinceReset;
  }

  /**
   * Drop everything still queued and rebase the clock to `positionSeconds`.
   *
   * A seek invalidates the audio already scheduled — it belongs to the old
   * position and must not be heard — and the reported position has to continue
   * from the new one rather than restart at zero.
   *
   * `chunksScheduled` and `underruns` are deliberately NOT reset: they are
   * session counters, and the stats bridge banks underruns whenever it sees the
   * count drop, so zeroing them here would double-count. Clearing `started`
   * means the first chunk after the seek takes the fresh-start path in
   * {@link schedule} rather than being mistaken for an underrun.
   */
  resetTo(positionSeconds: number): void {
    this.stopAll();
    this.nextStartTime = 0;
    this.firstStartTime = 0;
    this.started = false;
    this.scheduledSeconds = 0;
    // Reset, unlike `chunksScheduled`: this one exists to be compared against a report count the
    // engine also zeroes here, and the sources just silenced will never report.
    this.chunksSinceReset = 0;
    this.positionOffsetSeconds = Math.max(0, positionSeconds);
  }

  /**
   * Stop and drop every still-scheduled source (called on stop/close).
   *
   * `keepSourcesFor` lets an opt-in crossfade ring the outgoing tune out: the
   * sources are released from this scheduler but left running for that long
   * while the sink's gain ramps down, then stopped. Without it — the default —
   * everything is silenced immediately, which is what a switchover must do so
   * two tunes can never be audible at once.
   */
  stopAll(options: { keepSourcesFor?: number } = {}): void {
    const keepFor = options.keepSourcesFor ?? 0;
    if (keepFor > 0) {
      const fading = [...this.live];
      this.live.clear();
      for (const source of fading) source.onended = null;
      setTimeout(() => {
        for (const source of fading) {
          try {
            source.stop();
          } catch {
            // Already ended: nothing to stop.
            void 0;
          }
        }
      }, keepFor);
      return;
    }
    for (const source of this.live) {
      try {
        source.onended = null;
        source.stop();
      } catch (error) {
        // A source that already ended throws on stop(); harmless during teardown.
        addLog("debug", "Local SID: source stop failed (ignored during teardown)", {
          error: (error as Error)?.message ?? String(error),
        });
      }
    }
    this.live.clear();
  }
}
