/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Send on-device playback out through the same native track the A/V mirror uses.
 *
 * On-device playback sounded thin and quiet next to the same tune rendered by the C64 and streamed
 * back — "tinny, lacking bass and definition". It was not the SID emulation. Measured on a Pixel 4
 * against a c64u, same tune, same volume, microphone at the speaker:
 *
 *                    local          mirror
 *   level            +92.7 dB       +100.2 dB
 *   120-300 Hz        0.10%           3.33%
 *   300-700 Hz        3.18%          13.22%
 *
 * The PCM behind both is the same amplitude (engine rms ~2200, wire rms ~2400) and the engine's own
 * render has 26% of its energy in 120-300 Hz, so the bass was being lost *after* the samples. The
 * cause is which AudioFlinger path each took. From `dumpsys media.audio_policy` while each played:
 *
 *   mirror   Stream: 3; Flags: 00000004     AUDIO_OUTPUT_FLAG_FAST
 *   local    Stream: 3; Flags: 00004001     MMAP/direct
 *
 * Both declare `AUDIO_CONTENT_TYPE_MUSIC` / `AUDIO_USAGE_MEDIA`, so this is not a usage or routing
 * mistake — it is that Web Audio inside the WebView lands on a direct output that bypasses the
 * mixer's effect chain, and on this device that chain is the speaker's own EQ and loudness
 * processing. The mirror goes through `AudioTrack` on the fast mixer and gets it.
 *
 * So the fix is not a filter or an equaliser of our own: it is to stop having two output paths.
 * This adapter presents the {@link AudioScheduleSink} slice the chunk scheduler expects, backed by
 * the native `AudioPipeline` the mirror already feeds, so both routes reach the speaker through
 * identical processing.
 *
 * The clock is the interesting part. Web Audio hands out a real audio clock; here the equivalent is
 * the native playhead — what has been written, less what is still queued ahead of the speaker. The
 * pipeline reports the queue depth on every write, so the playhead is sampled from that and
 * interpolated with wall time in between. Getting this wrong is not subtle: the scheduler uses it to
 * decide when a chunk is late, so a clock that runs fast invents underruns and one that runs slow
 * lets the ring overflow.
 */

import { addLog } from "@/lib/logging";
import { startupBufferMs } from "./renderThroughput";
import type { AudioScheduleBuffer, AudioScheduleSink, AudioScheduleSource } from "./localSidChunkScheduler";
import type { LocalSidAudioSink } from "./localSidEngine";

/** Int16 full scale — the scheduler hands out floats in [-1, 1). */
const INT16_SCALE = 32768;

/**
 * Target depth for the native track, in ms, and the ceiling the ring is allowed to reach.
 *
 * Deliberately far deeper than the mirror's. Nothing is waiting on on-device playback — there is no
 * live machine at the other end whose input has to stay in step — so a second of audio queued ahead
 * costs nothing anyone can hear. What it buys is everything: the samples come from a WASM engine on
 * the JS thread, which also runs the UI, so the feed has to survive that thread being busy. At a few
 * hundred milliseconds it did not.
 */
const TARGET_BUFFER_MS = 15000;
const MAX_RING_MS = 20000;

/**
 * How much audio the pipeline holds before the first sound — learned, not fixed.
 *
 * See `renderThroughput`: the figure is derived from how fast this device has been measured to render,
 * so a quick device barely waits and a slow one waits enough not to run dry. A tune that starts and
 * then pauses half a second later sounds broken; one that starts a moment later sounds like loading.
 *
 * Small, and separate from the target on purpose. The pipeline primes to its target by default, which
 * is right when the target is a fraction of a second and absurd when it is fifteen: playback would
 * not start for fifteen seconds, and because the writer stops short of the target — it has to, or it
 * would overfill — it never started at all. That was silence on the device, with twelve seconds
 * sitting in a ring waiting for fifteen. Playback begins under a second in, and the ring goes on
 * filling behind it.
 *
 * Not smaller than this. The engine renders about 2.3x faster than real time once warm, so in the
 * first seconds the margin between filling the ring and draining it is thin, and at a fifth of a
 * second the ring could still touch zero before it got ahead — heard as a single ~0.2 s pause about
 * two seconds into a tune, and then never again.
 */
const primeMs = () => startupBufferMs();

/**
 * HAL bursts in the AudioTrack's own buffer. The mirror uses 4, sized for input latency it cannot
 * afford to add; on-device playback has none to protect, and the deeper buffer is what absorbs the
 * native player thread being descheduled.
 */
const TRACK_BURSTS = 16;

/**
 * Stop writing once the pipeline holds this much.
 *
 * Below the depth at which the pipeline trims its own backlog, so audio is never handed over only to
 * be thrown away.
 */
const HIGH_WATER_MS = 12000;

/**
 * How much audio goes in one write.
 *
 * Measured on a Pixel 4, cost is almost all per-call rather than per-byte — a payload carrying 43 ms
 * of audio cost 17 ms to encode and deliver, one carrying 1067 ms cost 36 ms. So small writes are
 * what starve the pipeline: at 100 ms per write there was barely five times real-time headroom, and
 * it was being spent competing with the SID renderer on the same thread. The device showed 3 seconds
 * of audio stuck in this queue while the native ring sat at 98 ms. A one-second write costs 3.6% of a
 * second, which leaves the thread to the renderer.
 */
const SLICE_MS = 4000;

/**
 * How long the pump waits when the pipeline is full, before asking it again how much it is holding.
 *
 * The accuracy of this delay does not matter, which is the point. An earlier version estimated the
 * drain by subtracting the delay from its own figure, which put pacing back at the mercy of
 * `setTimeout` on a thread that is also running the SID renderer — when that thread was busy the
 * estimate drifted, the pump stopped feeding, and the ring emptied. Measured on the device: 3 to 5
 * seconds of audio waiting in this queue while the native ring read 0 ms. Re-reading the true depth
 * costs a cheap plain-field call and cannot drift.
 */
const PUMP_IDLE_MS = 60;

/**
 * How often the playhead is checked for chunks that have finished.
 *
 * This has to be independent of whether there is anything left to write. The first version only
 * checked inside the write loop, which exits as soon as its queue empties — so the callback telling
 * the engine to render the next chunk never fired, and playback stalled until something else woke it.
 * Heard on the device as a ~1.2 s cutout every ~3 s, with the pipeline itself reporting no drops and
 * no concealment, because nothing was being produced for it to drop.
 */
const TICK_MS = 20;

export interface NativeLocalAudioBackend {
  openAudioTrack(options: {
    sampleRate: number;
    bufferMs?: number;
    maxRingMs?: number;
    trackBursts?: number;
    primeMs?: number;
  }): Promise<{ sampleRate: number; bufferMs: number }>;
  writeAudioTrack(options: { data: string }): Promise<{ bufferedMs?: number } | undefined>;
  closeAudioTrack(options?: Record<string, never>): Promise<void>;
  /** Drop queued-but-unplayed audio, so a pause or seek is immediate despite the deep ring. */
  flushAudioTrack?(options?: Record<string, never>): Promise<void>;
  /** Current pipeline state. Plain field reads, so cheap enough to poll while waiting. */
  readAudioStats?(options?: Record<string, never>): Promise<{ bufferedMs?: number } | undefined>;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

/** A planar float buffer, the shape the scheduler fills. */
class PlanarBuffer implements AudioScheduleBuffer {
  readonly channels: Float32Array[];

  constructor(
    channelCount: number,
    readonly frames: number,
  ) {
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[Math.min(channel, this.channels.length - 1)];
  }
}

class NativeLocalSidSink implements AudioScheduleSink {
  /** Frames handed to the pipeline. With the queue depth, this gives the playhead. */
  private writtenFrames = 0;
  /** Playhead at the last stats sample, in seconds, and when that sample was taken. */
  private playheadSec = 0;
  private playheadAtMs = performance.now();
  /** Queue depth the pipeline last reported, in seconds. */
  private queuedSec = 0;
  private suspended = false;
  private closed = false;
  private opening: Promise<boolean> | null = null;
  private opened = false;
  private gain = 1;
  /** An in-flight fade: where the gain is heading, and how fast, in gain units per second. */
  private fade: { to: number; perSecond: number } | null = null;
  /** Slices waiting to go out, in play order. */
  private queue: Int16Array[] = [];
  private pumping = false;
  /** Chunk ends still to be announced, as playhead seconds. */
  private endings: { at: number; fire: () => void }[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly sampleRate: number,
    private readonly backend: NativeLocalAudioBackend,
  ) {}

  /** Supply-side counters, for HIL diagnosis. */
  debug(): Record<string, number> {
    return {
      queuedSlices: this.queue.length,
      queuedSec: this.queuedSec,
      writtenSec: this.writtenFrames / this.sampleRate,
      playhead: this.currentTime,
      endings: this.endings.length,
      pumping: this.pumping ? 1 : 0,
    };
  }

  get currentTime(): number {
    if (this.suspended) return this.playheadSec;
    // Clamped to what has actually been handed over: the speaker cannot be past audio that was never
    // written. Without the clamp the wall-clock term ran away between writes — measured on the device
    // as a playhead of 4.79 s against 3.7 s ever written, which the scheduler reads as "the audio ran
    // out" and resyncs, and which is heard as a cut.
    const written = this.writtenFrames / this.sampleRate;
    return Math.min(written, this.playheadSec + (performance.now() - this.playheadAtMs) / 1000);
  }

  createBuffer(channels: number, frames: number): AudioScheduleBuffer {
    return new PlanarBuffer(Math.max(1, channels), frames);
  }

  createSource(buffer: AudioScheduleBuffer): AudioScheduleSource {
    const planar = buffer as PlanarBuffer;
    let ended: (() => void) | null = null;
    let cancelled = false;

    const source: AudioScheduleSource = {
      start: (when: number) => {
        if (cancelled || this.closed) return;
        // Queued, not timed. Pacing is the pipeline's job: it drains at the DAC's rate and reports
        // how much it is holding, and the pump treats that as backpressure. Releasing slices on
        // setTimeout instead — the first version of this — put the feed at the mercy of a JS thread
        // that is also rendering the SID, and measured on the device as a queue swinging between
        // 444 ms and 53 ms with 670 KB dropped in eight seconds. That is heard as stuttering.
        const sliceFrames = Math.max(1, Math.round((SLICE_MS / 1000) * this.sampleRate));
        for (let offset = 0; offset < planar.frames; offset += sliceFrames) {
          const frames = Math.min(sliceFrames, planar.frames - offset);
          this.queue.push(this.interleave(planar, offset, frames));
        }
        this.endings.push({
          at: when + planar.frames / this.sampleRate,
          fire: () => {
            if (!cancelled) ended?.();
          },
        });
        this.startTicking();
        void this.pump();
      },
      stop: () => {
        cancelled = true;
      },
      set onended(handler: (() => void) | null) {
        ended = handler;
      },
      get onended() {
        return ended;
      },
    };
    return source;
  }

  /** Interleave one slice to S16, applying the current gain and any fade in progress. */
  private interleave(planar: PlanarBuffer, offset: number, frames: number): Int16Array {
    const channels = planar.channels.length;
    // The pipeline's wire format is interleaved stereo, so a mono render is duplicated rather than
    // left to be read as two channels running at half speed.
    const outChannels = 2;
    const pcm = new Int16Array(frames * outChannels);
    const perFrame = this.fade ? this.fade.perSecond / this.sampleRate : 0;
    let gain = this.gain;

    for (let frame = 0; frame < frames; frame += 1) {
      if (this.fade) {
        gain += perFrame;
        gain = this.fade.perSecond >= 0 ? Math.min(gain, this.fade.to) : Math.max(gain, this.fade.to);
      }
      for (let channel = 0; channel < outChannels; channel += 1) {
        const source = planar.channels[Math.min(channel, channels - 1)];
        const value = Math.max(-1, Math.min(1, source[offset + frame] * gain));
        pcm[frame * outChannels + channel] = Math.round(value * (value < 0 ? INT16_SCALE : INT16_SCALE - 1));
      }
    }
    this.gain = gain;
    if (this.fade) {
      const done = this.fade.perSecond >= 0 ? gain >= this.fade.to : gain <= this.fade.to;
      if (done) this.fade = null;
    }
    return pcm;
  }

  /**
   * Keep the playhead under observation for as long as there is anything outstanding.
   *
   * Separate from the write loop on purpose: chunks finish playing long after the last of their
   * audio was handed over, and it is those completions that drive the engine to render more.
   */
  private startTicking(): void {
    if (this.ticker !== null || this.closed) return;
    this.ticker = setInterval(() => {
      if (this.closed) return;
      this.announceEndings();
      if (this.queue.length) void this.pump();
      else if (!this.endings.length && this.ticker !== null) {
        clearInterval(this.ticker);
        this.ticker = null;
      }
    }, TICK_MS);
  }

  /** Feed the pipeline as fast as it will take, and no faster. */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.closed && this.queue.length) {
        if (this.suspended) {
          await new Promise((resolve) => setTimeout(resolve, PUMP_IDLE_MS));
          continue;
        }
        if (this.queuedSec * 1000 >= HIGH_WATER_MS) {
          await new Promise((resolve) => setTimeout(resolve, PUMP_IDLE_MS));
          this.announceEndings();
          // Ask, do not guess.
          this.queuedSec = await this.readQueuedSec();
          continue;
        }
        if (!(await this.ensureOpen())) break;
        const slice = this.queue.shift();
        if (!slice) continue;
        await this.send(slice);
        this.announceEndings();
      }
    } finally {
      this.pumping = false;
    }
  }

  /** The pipeline's true queue depth, in seconds. */
  private async readQueuedSec(): Promise<number> {
    try {
      const stats = await this.backend.readAudioStats?.({});
      if (stats && typeof stats.bufferedMs === "number") {
        this.noteDepth(stats.bufferedMs);
        return Math.max(0, stats.bufferedMs / 1000);
      }
    } catch (error) {
      // Treat an unanswered read as "room to write": starving the speaker is the worse failure of
      // the two, and the next write reports the true depth anyway.
      addLog("debug", "Native audio: queue-depth read failed; assuming room to write", {
        error: (error as Error)?.message ?? String(error),
      });
    }
    return 0;
  }

  /** Record a depth reading against the playhead, whatever call produced it. */
  private noteDepth(bufferedMs: number): void {
    this.queuedSec = Math.max(0, bufferedMs / 1000);
    this.playheadSec = this.writtenFrames / this.sampleRate - this.queuedSec;
    this.playheadAtMs = performance.now();
  }

  private async send(slice: Int16Array): Promise<void> {
    const bytes = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
    try {
      const stats = await this.backend.writeAudioTrack({ data: toBase64(bytes) });
      this.writtenFrames += slice.length / 2;
      // The playhead is what has been written less what is still queued, which ties the clock to the
      // DAC rather than to wall time.
      this.noteDepth(stats?.bufferedMs ?? 0);
    } catch (error) {
      addLog("warn", "Native audio: on-device write failed", {
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  /** Tell the scheduler about chunks the speaker has passed, so it renders the next one. */
  private announceEndings(): void {
    if (!this.endings.length) return;
    const now = this.currentTime;
    const due = this.endings.filter((entry) => entry.at <= now);
    if (!due.length) return;
    this.endings = this.endings.filter((entry) => entry.at > now);
    for (const entry of due) entry.fire();
  }

  private ensureOpen(): Promise<boolean> {
    if (this.opened) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    this.opening ??= this.backend
      .openAudioTrack({
        sampleRate: Math.round(this.sampleRate),
        bufferMs: TARGET_BUFFER_MS,
        maxRingMs: MAX_RING_MS,
        trackBursts: TRACK_BURSTS,
        primeMs: primeMs(),
      })
      .then(() => {
        this.opened = true;
        return true;
      })
      .catch((error) => {
        // Cleared, so the next write tries again. Caching a rejected attempt meant one failure at the
        // wrong moment — a track the platform was still tearing down, say — silenced the sink for the
        // rest of its life, with every subsequent write returning the same remembered "no".
        this.opening = null;
        addLog("warn", "Native audio: on-device AudioTrack open failed", {
          error: (error as Error)?.message ?? String(error),
        });
        return false;
      });
    return this.opening;
  }

  setGain(value: number): void {
    this.fade = null;
    this.gain = Math.max(0, Math.min(1, value));
  }

  fadeTo(target: number, ms: number): void {
    const to = Math.max(0, Math.min(1, target));
    if (ms <= 0) {
      this.setGain(to);
      return;
    }
    this.fade = { to, perSecond: ((to - this.gain) * 1000) / ms };
  }

  /**
   * Drop everything queued, here and in the pipeline, and restart the clock.
   *
   * The clock has to go back to zero with it: the scheduler resets its own position on a seek and
   * then schedules against `currentTime`, so a playhead still counting the old position would put the
   * new audio in the past and have it discarded as late.
   */
  flush(): void {
    this.queue = [];
    this.endings = [];
    this.writtenFrames = 0;
    this.queuedSec = 0;
    this.playheadSec = 0;
    this.playheadAtMs = performance.now();
    void this.backend.flushAudioTrack?.().catch((error) => {
      addLog("debug", "Native audio: flush failed", { error: (error as Error)?.message ?? String(error) });
    });
  }

  suspend(): void {
    // Freeze the clock where it stands, so nothing scheduled against it is judged late on resume.
    this.playheadSec = this.currentTime;
    this.suspended = true;
    // The ring holds a couple of seconds, which would otherwise keep sounding after a pause.
    this.queue = [];
    void this.backend.flushAudioTrack?.().catch(() => {
      // A pipeline that has already gone has nothing to flush.
    });
  }

  resume(): void {
    if (!this.suspended) return;
    this.playheadAtMs = performance.now();
    this.suspended = false;
    void this.pump();
  }

  close(): void {
    this.closed = true;
    void this.backend.flushAudioTrack?.().catch(() => {
      // Nothing queued, or no pipeline left to queue into.
    });
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.queue = [];
    this.endings = [];
    if (this.opened || this.opening) {
      void this.backend.closeAudioTrack().catch(() => {
        // Closing a track that is already gone is not worth reporting.
      });
    }
    this.opened = false;
  }
}

/** Whether this platform has a native track to play through. */
export const nativeLocalAudioAvailable = (): boolean =>
  typeof globalThis !== "undefined" &&
  Boolean((globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

/**
 * Build the sink, or return null when this platform has no native track to use.
 *
 * Returning null rather than throwing is deliberate: the caller falls back to Web Audio, which is
 * the only option on the web build and on iOS, where the plugin does not exist at all.
 */
export const createNativeLocalSidSink = (
  sampleRate: number,
  backend: NativeLocalAudioBackend | null,
): LocalSidAudioSink | null => {
  if (!backend) return null;
  const sink = new NativeLocalSidSink(sampleRate, backend);
  // Debug seam: lets a HIL session see the supply side (what the scheduler has handed over and what
  // is waiting) alongside the pipeline's own stats, which only show the demand side.
  (globalThis as Record<string, unknown>).__localSinkDebug = () => sink.debug();
  return {
    sink,
    resume: () => sink.resume(),
    suspend: () => sink.suspend(),
    fadeOut: (ms: number) => sink.fadeTo(0, ms),
    fadeIn: (ms: number, toGain = 1) => sink.fadeTo(toGain, ms),
    setGain: (value: number) => sink.setGain(value),
    flush: () => sink.flush(),
    close: () => sink.close(),
  };
};
