/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * On-device playback through the native audio feed, on Android.
 *
 * Why native at all: Web Audio inside the WebView lands on a direct output that bypasses the mixer's
 * effect chain, which on a Pixel 4 is the speaker's own EQ and loudness processing. Measured with a
 * microphone at the speaker, the same tune at the same volume came out 7.5 dB quieter with 0.10% of
 * its energy in 120-300 Hz against the mirror's 3.33% (`dumpsys media.audio_policy`: Flags 00004001
 * MMAP/direct versus 00000004 FAST). Going through the same `AudioPipeline` as the A/V mirror makes
 * both reach the speaker through identical processing.
 *
 * What this file does: nothing to the samples. Every renderer's PCM goes to the native
 * `LocalAudioFeed` — libSidplayEZ's as a reference to a native buffer, the WASM renderers' as one
 * binary message per chunk (`nativePcmPort`) or, on a WebView that cannot send ArrayBuffers, as
 * base64 over the Capacitor bridge. The feed queues it in sequence order, writes it into the
 * pipeline with backpressure, applies the crossfade fade-in, recovers and mixes the outgoing tune for
 * a crossfade, watches for silence and for a track that has stopped consuming, and reports the
 * playhead. This sink is the controller: it numbers and hands over chunks, keeps the scheduler's
 * clock from the playhead the feed reports, and tells the engine when chunks have played.
 */

import { Capacitor } from "@capacitor/core";
import { claimNativeTrack, isSuperseded, nextSerial, releaseNativeTrack } from "@/lib/audio/nativeTrackOwnership";
import { addLog } from "@/lib/logging";
import { SidAudio, type SidAudioPlugin, type SidAudioSessionStats } from "@/lib/native/sidAudio";
import { StreamUdp } from "@/lib/native/streamUdp";
import { bytesToBase64 } from "@/lib/encoding/base64";
import { traceLocalSid } from "./localSidTrace";
import { startupBufferMs } from "./renderThroughput";
import type { AudioScheduleBuffer, AudioScheduleSink, AudioScheduleSource } from "./localSidChunkScheduler";
import type { CrossfadeTail, LocalSidAudioSink } from "./localSidAudioSink";
import { isNativePcm, payloadFrames, type PcmPayload } from "./sidRenderer/pcmPayload";
import { confirmedPcmPort, pcmMessage, PCM_HEADER_SAMPLES } from "./sidRenderer/nativePcmPort";
import { ensureSidAudioAttached } from "./sidRenderer/sidAudioAttach";
import type { SidRendererId } from "./sidRenderer/sidRendererAvailability";

/** Room a WASM chunk is produced with, in front of its samples, for the binary message header. */
export const NATIVE_PCM_HEADER_SAMPLES = PCM_HEADER_SAMPLES;

/**
 * The native track's target depth and ring ceiling, in ms.
 *
 * Far deeper than the mirror's. Nothing waits on on-device playback, so seconds queued ahead cost
 * nothing anyone can hear, and they are what lets the feed survive a WASM renderer on a busy JS
 * thread. Deep buffering also means pause, seek and track changes must flush, which they do.
 */
const TARGET_BUFFER_MS = 15000;
const MAX_RING_MS = 20000;

/** HAL bursts in the AudioTrack's own buffer; deeper than the mirror's 4, to absorb descheduling. */
const TRACK_BURSTS = 16;

/** How often chunk completions are checked against the playhead. */
const TICK_MS = 50;

/** How often the feed is asked where the playhead is. Cheap: the feed publishes a snapshot. */
const STATS_POLL_MS = 250;

/**
 * Priming is separate from the target and learned per renderer (`renderThroughput`): waiting for
 * fifteen seconds before the first sound is not a start-up delay, and a writer that stops short of
 * the target would never start at all.
 */
const primeMsFor = (renderer: SidRendererId | undefined) => startupBufferMs(renderer);

/** The part of the `SidAudio` plugin this sink drives, plus the object it shares track ownership on. */
export interface NativeLocalAudioBackend {
  feed: Pick<
    SidAudioPlugin,
    | "describe"
    | "openSession"
    | "enqueueBuffer"
    | "enqueuePcm"
    | "flush"
    | "pause"
    | "resume"
    | "setGain"
    | "fade"
    | "fadeIn"
    | "resetSilence"
    | "beginTransition"
    | "takeTail"
    | "adoptTail"
    | "release"
    | "close"
    | "stats"
  >;
  /** The key the A/V mirror's sink also claims the shared track on (the StreamUdp plugin). */
  trackOwner: object;
  /** Resolves to the binary port when it has been shown to work, or null for the base64 path. */
  binaryPort: () => Promise<{ postMessage(message: ArrayBuffer): void } | null>;
  /** Called before the first session, so the native side has dropped any earlier page's state. */
  attach: () => Promise<void>;
}

interface NativeCrossfadeTail extends CrossfadeTail {
  readonly tailId: number;
}

let nextTailId = 1;

const describeError = (error: unknown) => (error as Error)?.message ?? String(error);

class NativeLocalSidSink implements AudioScheduleSink {
  readonly serial = nextSerial();
  private seq = 0;
  private readonly opened: Promise<void>;
  /** Frames handed over since the last flush: the scheduler's clock may never run past them. */
  private handedFrames = 0;
  private playheadSec = 0;
  private playheadAtMs = performance.now();
  /** How far the clock may interpolate past the last report: what the track was holding then. */
  private interpolateLimitSec = 0;
  private stats: SidAudioSessionStats | null = null;
  private reopens = 0;
  private maxUnderruns = 0;
  private suspended = false;
  private closed = false;
  private claimed = false;
  private polling = false;
  private lastPollAtMs = 0;
  private endings: { at: number; fire: () => void }[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private port: { postMessage(message: ArrayBuffer): void } | null = null;
  private sent = 0;

  constructor(
    readonly sampleRate: number,
    private readonly backend: NativeLocalAudioBackend,
    renderer: SidRendererId | undefined,
  ) {
    const settings = {
      serial: this.serial,
      sampleRate: Math.round(sampleRate),
      bufferMs: TARGET_BUFFER_MS,
      maxRingMs: MAX_RING_MS,
      trackBursts: TRACK_BURSTS,
      primeMs: primeMsFor(renderer),
    };
    this.opened = backend
      .attach()
      .then(() => backend.feed.openSession(settings))
      .catch((error: unknown) => {
        addLog("warn", "Native audio: opening the local audio session failed", {
          service: "local-sid",
          error: describeError(error),
        });
      });
    void backend.binaryPort().then((port) => {
      this.port = port;
    });
  }

  get currentTime(): number {
    if (this.suspended) return this.playheadSec;
    const elapsed = (performance.now() - this.playheadAtMs) / 1000;
    const interpolated = this.playheadSec + Math.min(elapsed, this.interpolateLimitSec);
    return Math.min(this.handedFrames / this.sampleRate, interpolated);
  }

  createBuffer(): AudioScheduleBuffer {
    throw new Error("The native sink takes S16 PCM directly; float buffers are for Web Audio");
  }

  createSource(): AudioScheduleSource {
    throw new Error("The native sink takes S16 PCM directly; float buffers are for Web Audio");
  }

  createPcmSource(pcm: PcmPayload, channels: number): AudioScheduleSource {
    let ended: (() => void) | null = null;
    let cancelled = false;
    return {
      start: (when: number) => {
        if (cancelled || this.closed) return;
        const frames = payloadFrames(pcm, channels);
        if (frames <= 0) return;
        void this.send(pcm, channels, this.nextSeq(), frames);
        this.handedFrames += frames;
        this.endings.push({
          at: when + frames / this.sampleRate,
          fire: () => {
            if (!cancelled) ended?.();
          },
        });
        this.startTicking();
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
  }

  private async send(pcm: PcmPayload, channels: number, seq: number, frames: number): Promise<void> {
    await this.opened;
    if (this.closed) return;
    // Take the track with the first chunk that actually goes to it, not on construction: the next
    // tune's sink is built well before it has audio, and claiming then would silence the outgoing
    // tune's tail early. The native feed applies the same rule to its own sessions.
    if (!this.claimed) {
      this.claimed = true;
      claimNativeTrack(this.backend.trackOwner, this, this.serial);
      traceLocalSid("first-write", { serial: this.serial });
    }
    try {
      if (isNativePcm(pcm)) {
        await this.backend.feed.enqueueBuffer({
          serial: this.serial,
          seq,
          bufferId: pcm.bufferId,
          startFrame: pcm.startFrame,
          frames: pcm.frames,
        });
      } else {
        const stereo = channels === 2 ? pcm : toStereo(pcm, frames);
        if (this.port) {
          this.port.postMessage(pcmMessage(this.serial, seq, stereo));
        } else {
          const bytes = new Uint8Array(stereo.buffer, stereo.byteOffset, frames * 4);
          await this.backend.feed.enqueuePcm({ serial: this.serial, seq, data: bytesToBase64(bytes) });
        }
      }
      this.sent += 1;
    } catch (error) {
      addLog("warn", "Native audio: handing a chunk to the local audio feed failed", {
        service: "local-sid",
        seq,
        error: describeError(error),
      });
    }
  }

  private startTicking(): void {
    if (this.ticker !== null || this.closed) return;
    this.ticker = setInterval(() => {
      if (this.closed) return;
      if (performance.now() - this.lastPollAtMs >= STATS_POLL_MS) void this.poll();
      this.announceEndings();
    }, TICK_MS);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    this.lastPollAtMs = performance.now();
    try {
      const stats = await this.backend.feed.stats({ serial: this.serial });
      if (this.closed || !stats.known) return;
      this.stats = stats;
      this.maxUnderruns = Math.max(this.maxUnderruns, stats.underruns ?? 0);
      if (!this.suspended) {
        this.playheadSec = (stats.playedFrames ?? 0) / this.sampleRate;
        this.playheadAtMs = performance.now();
        this.interpolateLimitSec = stats.active ? (stats.bufferedMs ?? 0) / 1000 : 0;
      }
      if ((stats.reopens ?? 0) > this.reopens) {
        // The feed replaced a track that had stopped consuming, and what it held went with it. The
        // engine renders more only when told chunks are done, so the completions owed for that
        // audio are announced now — leaving them would trade a silent track for a stalled one.
        this.reopens = stats.reopens ?? 0;
        const orphaned = this.endings;
        this.endings = [];
        for (const entry of orphaned) entry.fire();
      }
    } catch (error) {
      addLog("debug", "Native audio: reading the local audio feed's stats failed", { error: describeError(error) });
    } finally {
      this.polling = false;
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

  private call(operation: string, attempt: () => Promise<unknown>): void {
    void this.opened
      .then(attempt)
      .catch((error: unknown) =>
        addLog("warn", `Native audio: ${operation} failed`, { service: "local-sid", error: describeError(error) }),
      );
  }

  /** Drop what is queued, here and in the track, and restart the clock, for a seek. */
  flush(): void {
    this.endings = [];
    this.handedFrames = 0;
    this.playheadSec = 0;
    this.interpolateLimitSec = 0;
    this.playheadAtMs = performance.now();
    const seq = this.nextSeq();
    this.call("flush", () => this.backend.feed.flush({ serial: this.serial, seq }));
  }

  /**
   * The next place in this session's stream. PCM and the commands that must take effect at a point
   * in it (flush, fades, the crossfade hand-over, release) share one sequence, so the feed applies
   * them in the order they were sent whichever channel each travelled on: PCM may take the binary
   * port while commands take the Capacitor bridge. Taken when the command is issued, not when its
   * call goes out, which may be later.
   */
  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  suspend(): void {
    this.playheadSec = this.currentTime;
    this.suspended = true;
    this.call("pause", () => this.backend.feed.pause({ serial: this.serial }));
  }

  resume(): void {
    if (!this.suspended) return;
    this.playheadAtMs = performance.now();
    this.suspended = false;
    this.call("resume", () => this.backend.feed.resume({ serial: this.serial }));
    this.startTicking();
  }

  setMasterGain(value: number): void {
    const gain = Math.max(0, Math.min(1, value));
    this.call("setting the level", () => this.backend.feed.setGain({ gain }));
  }

  fadeTo(target: number, ms: number): void {
    const seq = this.nextSeq();
    this.call("fade", () => this.backend.feed.fade({ serial: this.serial, seq, target, ms }));
  }

  fadeIn(ms: number, toGain: number): void {
    this.setMasterGain(toGain);
    const seq = this.nextSeq();
    this.call("fade-in", () => this.backend.feed.fadeIn({ serial: this.serial, seq, ms }));
  }

  isSilentFault(): boolean {
    return this.stats?.silentFault === true;
  }

  resetSilence(): void {
    if (this.stats) this.stats = { ...this.stats, silentFault: false, silentSeconds: 0 };
    this.call("resetting the silence detector", () => this.backend.feed.resetSilence({ serial: this.serial }));
  }

  underruns(): number {
    return this.maxUnderruns;
  }

  beginTailPlayout(seconds: number, rampOut = false): void {
    if (this.closed) return;
    const seq = this.nextSeq();
    this.call("starting the crossfade tail", () =>
      this.backend.feed.beginTransition({ serial: this.serial, seq, seconds, rampOut }),
    );
    traceLocalSid("tail-playout-begin", { seconds, rampOut });
  }

  takeTail(maxSeconds: number): NativeCrossfadeTail {
    const tailId = nextTailId++;
    this.endings = [];
    const seq = this.nextSeq();
    this.call("handing over the crossfade tail", () =>
      this.backend.feed.takeTail({ serial: this.serial, seq, tailId, maxSeconds }),
    );
    return { tailId, frames: Math.round(maxSeconds * this.sampleRate) };
  }

  adoptTail(tail: CrossfadeTail, seconds: number): void {
    const tailId = (tail as Partial<NativeCrossfadeTail>).tailId;
    if (typeof tailId !== "number" || seconds <= 0) return;
    const seq = this.nextSeq();
    this.call("adopting the crossfade tail", () =>
      this.backend.feed.adoptTail({ serial: this.serial, seq, tailId, seconds }),
    );
  }

  private stopTicking(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Stop feeding but leave the track playing, so the next tune writes straight onto its end. */
  releaseForHandover(): void {
    this.closed = true;
    this.stopTicking();
    this.endings = [];
    const seq = this.nextSeq();
    this.call("releasing the session", () => this.backend.feed.release({ serial: this.serial, seq }));
  }

  close(): void {
    this.closed = true;
    this.stopTicking();
    this.endings = [];
    // The native feed leaves a track alone that a newer session owns; this is the same rule on the
    // JS side, for the A/V mirror's sink that shares the track.
    if (!isSuperseded(this.backend.trackOwner, this.serial)) releaseNativeTrack(this.backend.trackOwner, this);
    this.call("closing the session", () => this.backend.feed.close({ serial: this.serial }));
  }

  debug(): Record<string, number> {
    return {
      serial: this.serial,
      seq: this.seq,
      sent: this.sent,
      handedSec: this.handedFrames / this.sampleRate,
      playhead: this.currentTime,
      endings: this.endings.length,
      bufferedMs: this.stats?.bufferedMs ?? -1,
      queuedFrames: this.stats?.queuedFrames ?? -1,
      binaryPort: this.port ? 1 : 0,
    };
  }
}

const toStereo = (mono: Int16Array, frames: number): Int16Array => {
  const out = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    out[i * 2] = mono[i];
    out[i * 2 + 1] = mono[i];
  }
  return out;
};

/**
 * Whether this platform has the native feed: Android with the `SidAudio` plugin. iOS has no native
 * audio plugin at all, so it — like the web build — plays through Web Audio.
 */
export const nativeLocalAudioAvailable = (): boolean => {
  try {
    return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("SidAudio");
  } catch (error) {
    addLog("debug", "Native audio: platform detection failed; using Web Audio", { error: describeError(error) });
    return false;
  }
};

export const defaultNativeLocalAudioBackend = (): NativeLocalAudioBackend => ({
  feed: SidAudio,
  trackOwner: StreamUdp,
  binaryPort: () => confirmedPcmPort(SidAudio),
  attach: () => ensureSidAudioAttached(SidAudio),
});

/**
 * Build the sink, or null when this platform has no native feed. Null rather than a throw: the
 * caller falls back to Web Audio, which is all the web build and iOS have.
 */
export const createNativeLocalSidSink = (
  sampleRate: number,
  backend: NativeLocalAudioBackend | null,
  renderer?: SidRendererId,
): LocalSidAudioSink | null => {
  if (!backend) return null;
  const sink = new NativeLocalSidSink(sampleRate, backend, renderer);
  // Debug seam: what the newest open sink has handed over, beside what the feed reports.
  const debugSeam = globalThis as { __localSinkDebug?: () => Record<string, unknown> };
  const debug = () => sink.debug();
  debugSeam.__localSinkDebug = debug;
  return {
    sink,
    audioUnderruns: () => sink.underruns(),
    isSilentFault: () => sink.isSilentFault(),
    takeCrossfadeTail: (seconds: number) => sink.takeTail(seconds),
    beginCrossfadeTailPlayout: (seconds: number) => sink.beginTailPlayout(seconds),
    beginCutPlayout: (seconds: number) => sink.beginTailPlayout(seconds, true),
    releaseForHandover: () => sink.releaseForHandover(),
    adoptCrossfadeTail: (tail: CrossfadeTail, seconds: number) => sink.adoptTail(tail, seconds),
    resetSilence: () => sink.resetSilence(),
    resume: () => sink.resume(),
    suspend: () => sink.suspend(),
    fadeOut: (ms: number) => sink.fadeTo(0, ms),
    // A tune opening at the listener's level: the level is the track's master gain, the blend is
    // the session's fade, which starts from silence so the two ramps of a crossfade are the two
    // halves of one fade.
    fadeIn: (ms: number, toGain = 1) => sink.fadeIn(ms, toGain),
    setGain: (value: number) => sink.setMasterGain(value),
    flush: () => sink.flush(),
    close: () => {
      sink.close();
      if (debugSeam.__localSinkDebug === debug) delete debugSeam.__localSinkDebug;
    },
  };
};
