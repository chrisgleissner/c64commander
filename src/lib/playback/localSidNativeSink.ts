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
import { traceLocalSid } from "./localSidTrace";
import { SilenceDetector } from "./silenceDetector";
import { startupBufferMs } from "./renderThroughput";
import type { AudioScheduleBuffer, AudioScheduleSink, AudioScheduleSource } from "./localSidChunkScheduler";
import type { LocalSidAudioSink } from "./localSidEngine";

/**
 * What the native pipeline reports back from a write or a stats read.
 *
 * `underruns` is `AudioTrack.underrunCount` — AudioFlinger's own count of the output running dry,
 * i.e. the speaker had nothing to play. It has always been on the wire; nothing read it, so the
 * pinned `audioUnderruns` budget was reporting the chunk scheduler's JS-side accounting instead.
 * Those are different events: the scheduler counts a chunk handed over after the previous one
 * finished, which on this sink is decoupled from whether the native ring drained.
 */
export interface NativeAudioStats {
  bufferedMs?: number;
  underruns?: number;
}

/** How often the native depth is re-read once nothing is being written. */
const IDLE_DEPTH_POLL_MS = 500;
/**
 * How long since the last write before the depth is allowed to be judged at all.
 *
 * Short, and deliberately separate from {@link STALL_GRACE_MS}: it only has to be long enough to be
 * sure nothing is currently going into the pipeline. Reusing the stall window here would stack the
 * two and leave a listener in silence for eight seconds before anything recovered.
 */
const WRITE_QUIET_MS = 1000;
/** How long an idle, non-draining native buffer is tolerated before the track is re-opened. */
const STALL_GRACE_MS = 4000;
/** Depth reduction that counts as real progress rather than reporting jitter. */
const DEPTH_PROGRESS_EPSILON_MS = 20;

/** Int16 full scale — the scheduler hands out floats in [-1, 1). */
const INT16_SCALE = 32768;

/**
 * How long a change to the listener's level takes to arrive, in milliseconds of audio.
 *
 * A gain that differs between one sample and the next is a step discontinuity, and a step in the
 * middle of a waveform is heard as a click; a slider being dragged produces a run of them, which is
 * the noise usually called zipper. Ramping across the change removes it. Twenty milliseconds is what
 * the Web Audio sink already uses for the same job, so the two output paths behave identically, and
 * it is short enough that pressing Mute still reads as immediate.
 */
const MASTER_RAMP_MS = 20;

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
 * How shallow the native ring is kept while a track change is in progress.
 *
 * The ring is first-in-first-out and shared by both tunes, so whatever is in it plays before
 * anything written afterwards. At the normal 12 s depth the incoming tune's first sample would
 * queue up to twelve seconds behind the outgoing one, and no amount of mixing could overlap them.
 * During a transition the outgoing tune therefore writes only a fraction of a second at a time,
 * which is the most that can still be committed when the incoming tune takes over.
 */
const TRANSITION_HIGH_WATER_MS = 250;

/**
 * How much of what has been written is kept, in seconds.
 *
 * The ring holds up to `HIGH_WATER_MS`, and a track change flushes it — which throws away precisely
 * the audio a crossfade needs to fade out. Keeping a copy of recent writes is what makes that audio
 * available again as data.
 *
 * It has to be **deeper than the pipeline**, not merely as deep as the fade. What is recovered is
 * the part of the history that has not been played yet, found by counting back from the most recent
 * write by the pipeline's own depth. If the history is shallower than that depth the count runs off
 * the end of it and recovery starts at the oldest sample there is, which is audio from further back
 * in the tune that the listener has already heard: the transition would jump backwards by several
 * seconds. A steady test tone cannot show this — every sample of it is identical — which is why it
 * was found by counting samples rather than by listening.
 */
const TAIL_HISTORY_SECONDS = HIGH_WATER_MS / 1000 + 2;

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
  writeAudioTrack(options: { data: string }): Promise<NativeAudioStats | undefined>;
  closeAudioTrack(options?: Record<string, never>): Promise<void>;
  /** Drop queued-but-unplayed audio, so a pause or seek is immediate despite the deep ring. */
  flushAudioTrack?(options?: Record<string, never>): Promise<void>;
  /** Master attenuation applied by the pipeline as samples leave its ring (0..1). */
  setAudioTrackGain?(options: { gain: number }): Promise<void>;
  /** Current pipeline state. Plain field reads, so cheap enough to poll while waiting. */
  readAudioStats?(options?: Record<string, never>): Promise<NativeAudioStats | undefined>;
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
  private nativeUnderruns = 0;
  /** Where this sink comes in the order they were created; later retires earlier. */
  private readonly serial: number;
  /**
   * The outgoing tune's continuing audio, to be summed under this one for a crossfade.
   *
   * A crossfade means two tunes sounding at once, and there is only one AudioTrack. Writing from
   * two sinks does not mix them — the slices interleave — and the per-sink gain ramp is applied
   * when a slice is converted, so it cannot touch audio that has already been converted and queued.
   * Both routes to an overlap are therefore closed, and the transition came out as a hard cut.
   *
   * So the incoming sink does the mixing itself: it takes what the outgoing sink had rendered but
   * not yet written, and adds it to its own slices with a falling ramp while its own `fadeIn`
   * raises it. One writer, two tunes, a real overlap.
   */
  private tail: { slices: Int16Array[]; cursor: number; frame: number; frames: number } | null = null;
  /** How much tail-only audio to emit at a time while the incoming tune has nothing of its own. */
  private get tailSliceFrames(): number {
    return Math.max(1, Math.round(this.sampleRate / 20));
  }
  /** How long the speaker has been given a flat signal. See `SilenceDetector`. */
  private readonly silence = new SilenceDetector();
  private suspended = false;
  private closed = false;
  private opening: Promise<boolean> | null = null;
  private opened = false;
  private gain = 1;
  /** An in-flight fade: where the gain is heading, and how fast, in gain units per second. */
  private fade: { to: number; perSecond: number } | null = null;
  /**
   * The listener's own level, 0..1, and a ramp towards a new one.
   *
   * Deliberately a second value rather than a second stage: it is multiplied into the crossfade gain
   * at the one place samples are converted, so nothing downstream has to know there are two of them.
   * What it must not be is the *same* value as {@link fade}. They answer different questions — "how
   * loud does the listener want this" and "how far through the blend between two tunes are we" — and
   * while they shared one field each one overwrote the other: moving the volume slider during a
   * crossfade cancelled the crossfade, and every crossfade discarded the listener's level.
   */
  private masterGain = 1;
  /** Cleared when the pipeline refuses the gain call, so the conversion takes over. */
  private nativeGainAvailable = true;
  private masterRamp: { to: number; perSecond: number } | null = null;
  /**
   * Whether any audio has been converted yet.
   *
   * A level set before the first sample has nothing to click against, so it is applied outright. This
   * matters at the start of every tune: the engine carries the listener's level onto each new sink,
   * and ramping into it from unity would open each track fractionally too loud.
   */
  private converted = false;
  /** Slices waiting to go out, in play order. */
  private queue: Int16Array[] = [];
  private pumping = false;
  /** When the native depth first stopped falling while idle, or null when it is draining. */
  private depthStalledSinceMs: number | null = null;
  /** Ticks since the depth was last polled while idle. */
  private idleTicks = 0;
  private lastDepthMs = Number.POSITIVE_INFINITY;
  /** When audio was last handed to the pipeline; a stall is only judged once writing has stopped. */
  private lastWriteAtMs = 0;
  /**
   * A copy of recent writes, oldest first, so the unplayed part can be recovered after a flush.
   *
   * Slices are stored by reference: `mixTail` is the only thing that alters one and it runs before
   * the write, so nothing changes them afterwards.
   */
  private history: Int16Array[] = [];
  private historyFrames = 0;
  /** The pipeline's depth at the last write, with the time it was read, to work out what is unplayed. */
  private lastBufferedMs = 0;
  /** True from the start of a track change until this sink stops writing. */
  private transitioning = false;
  /** Chunk ends still to be announced, as playhead seconds. */
  private endings: { at: number; fire: () => void }[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly sampleRate: number,
    private readonly backend: NativeLocalAudioBackend,
  ) {
    // Ownership is claimed on the first write, not here; the serial fixes the order. See `send`.
    this.serial = nextSerial();
  }

  /** How long the output has been flat, in seconds. Zero while anything audible is going out. */
  silentSeconds(): number {
    return this.silence.silentSeconds;
  }

  /** True once the flat stretch has gone on long enough to be a fault rather than a rest. */
  isSilentFault(): boolean {
    return this.silence.isFaulty;
  }

  /** Called when a new tune starts or playback resumes, so a fresh attempt is judged afresh. */
  resetSilence(): void {
    this.silence.reset();
  }

  /** Keep a copy of what went out, discarding anything older than the tail history needs. */
  private rememberWrite(slice: Int16Array): void {
    this.history.push(slice);
    this.historyFrames += slice.length / 2;
    const keep = TAIL_HISTORY_SECONDS * this.sampleRate;
    while (this.history.length > 1 && this.historyFrames - this.history[0].length / 2 >= keep) {
      this.historyFrames -= (this.history.shift() as Int16Array).length / 2;
    }
  }

  /**
   * Begin a track change: recover the audio this tune had queued but not yet played, and go on
   * playing it from JS while the next tune opens.
   *
   * The ring is flushed first. That is not optional — it may hold twelve seconds of this tune, and
   * the incoming tune cannot be heard until all of it has played. What the flush discards is put
   * back a fraction of a second at a time, so when the incoming tune's first slice arrives only a
   * little of this tune is committed and the rest can be mixed underneath it instead.
   *
   * `seconds` bounds how much is recovered, and is the whole budget: the caller sizes it to cover
   * opening the next tune AND the fade that follows, because until that tune has a sample to play
   * this is the only audio there is. Nothing is held back from the pipeline — an earlier version
   * reserved the fade's share and fed only the rest, which starved the pipeline and put a gap
   * exactly where the fade should have been.
   */
  beginTailPlayout(seconds: number): void {
    if (this.closed || this.transitioning) return;
    this.transitioning = true;
    const wanted = Math.max(0, Math.round(seconds * this.sampleRate));
    // What is still in the pipeline: the depth at the last write, less the time since. Approximate
    // by a few milliseconds, which shifts the seam by less than a slice.
    const elapsedMs = this.lastWriteAtMs ? Math.max(0, performance.now() - this.lastWriteAtMs) : 0;
    // Never count back further than the history actually holds: doing so starts the recovery at
    // audio the listener has already heard. With `TAIL_HISTORY_SECONDS` deeper than the pipeline
    // this cannot bite, and the clamp says so rather than relying on the two staying in step.
    const unplayedFrames = Math.min(
      this.historyFrames,
      Math.round((Math.max(0, this.lastBufferedMs - elapsedMs) / 1000) * this.sampleRate),
    );
    const recovered: Int16Array[] = [];
    let frames = 0;
    // Walk back from the most recent write until the unplayed audio is covered, then keep the slices
    // in play order. Anything older than that has already been heard.
    for (let i = this.history.length - 1; i >= 0 && frames < unplayedFrames; i -= 1) {
      recovered.unshift(this.history[i]);
      frames += this.history[i].length / 2;
    }
    // Trim to what was asked for, taking it from the playhead forwards.
    const capped: Int16Array[] = [];
    let kept = 0;
    for (const slice of recovered) {
      if (kept >= wanted) break;
      capped.push(slice);
      kept += slice.length / 2;
    }
    // Split the first slice so the write that closes the flush is short. A half-second slice takes
    // long enough to convert and hand across the bridge to be heard as part of the hole it is meant
    // to fill.
    const primerFrames = Math.round(this.sampleRate / 50);
    if (capped.length && capped[0].length / 2 > primerFrames) {
      const head = capped[0].subarray(0, primerFrames * 2);
      const rest = capped[0].subarray(primerFrames * 2);
      capped.splice(0, 1, head, rest);
    }
    this.queue = [...capped, ...this.queue];
    this.queuedSec = 0;
    this.history = [];
    this.historyFrames = 0;
    traceLocalSid("tail-playout-begin", { recovered: kept, unplayed: unplayedFrames, buffered: this.lastBufferedMs });
    void this.refillAfterFlush();
  }

  /**
   * Empty the pipeline and put the tail back into it, as one uninterrupted step.
   *
   * The gap between the two is audible. Flushing and then letting the ordinary pump loop discover
   * there is work left it a hole of about 200 ms in the middle of the transition on a Pixel 4: the
   * loop polls, sleeps, and re-reads the depth before it writes anything. This writes the first
   * slice itself, the instant the flush returns, and only then hands back to the pump.
   */
  private async refillAfterFlush(): Promise<void> {
    await (this.backend.flushAudioTrack?.() ?? Promise.resolve()).catch((error) => {
      // A pipeline that cannot be flushed still plays; the transition is merely less tidy.
      addLog("warn", "Native audio: flush before crossfade tail failed", {
        error: (error as Error)?.message ?? String(error),
      });
    });
    traceLocalSid("tail-playout-flushed", {});
    // Prime with a short slice so the first write is as small, and therefore as quick, as it can be.
    const first = this.queue.shift();
    if (first && !this.closed) {
      await this.send(first);
      traceLocalSid("tail-playout-primed", { frames: first.length / 2 });
    }
    if (!this.closed) void this.pump();
  }

  /**
   * Hand over what has been rendered but not yet played, so a successor can fade it out under
   * itself. Capped, because only the crossfade's worth is wanted — the rest of the tune is not.
   *
   * Emptying the queue is part of the handover: this sink must stop writing the moment its audio
   * belongs to the successor, or both would play it.
   */
  takeTail(maxSeconds: number): Int16Array[] {
    const maxFrames = Math.max(0, Math.round(maxSeconds * this.sampleRate));
    const out: Int16Array[] = [];
    let frames = 0;
    while (this.queue.length && frames < maxFrames) {
      const slice = this.queue.shift() as Int16Array;
      out.push(slice);
      frames += slice.length / 2;
    }
    this.queue = [];
    return out;
  }

  /** Sum `slices` under this sink's own output, fading them away across `seconds`. */
  adoptTail(slices: Int16Array[], seconds: number): void {
    const frames = slices.reduce((sum, s) => sum + s.length / 2, 0);
    if (frames === 0 || seconds <= 0) return;
    this.tail = { slices, cursor: 0, frame: 0, frames: Math.min(frames, Math.round(seconds * this.sampleRate)) };
    // Start feeding at once. Nothing else will: the incoming tune has not rendered a sample yet, and
    // during that gap the tail is the only audio there is.
    if (!this.closed) void this.pump();
  }

  /**
   * Mix the outgoing tune into this slice, in place.
   *
   * Summed rather than averaged, and clamped: two tunes at their own levels can exceed full scale
   * where they happen to peak together, and wrapping an Int16 turns that into a crack rather than
   * the clip it should be.
   */
  private mixTail(slice: Int16Array, sliceIsOwnAudio: boolean): number {
    const tail = this.tail;
    if (!tail) return 0;
    let mixedFrames = 0;
    for (let i = 0; i + 1 < slice.length; i += 2) {
      if (!tail.slices.length || tail.frame >= tail.frames) {
        this.tail = null;
        return mixedFrames;
      }
      const from = tail.slices[0] as Int16Array;
      // The fade only runs while there is something to fade *into*. Opening the next tune takes a
      // couple of seconds and rendering its first samples takes longer still, and until then this
      // sink writes silence with the tail folded into it. Ramping down during that stretch faded the
      // outgoing tune to nothing before the incoming one had made a sound, which the listener hears
      // as a gap between the two — the very thing the crossfade exists to remove. So while these are
      // empty slices the outgoing tune plays on at its own level, and the fade starts on the first
      // slice that carries audio of this tune's own.
      const gain = sliceIsOwnAudio ? 1 - tail.frame / tail.frames : 1;
      for (let ch = 0; ch < 2; ch += 1) {
        const mixed = (slice[i + ch] as number) + (from[tail.cursor + ch] as number) * gain;
        slice[i + ch] = mixed > 32767 ? 32767 : mixed < -32768 ? -32768 : mixed;
      }
      tail.cursor += 2;
      mixedFrames += 1;
      if (sliceIsOwnAudio) tail.frame += 1;
      if (tail.cursor >= from.length) {
        tail.slices.shift();
        tail.cursor = 0;
      }
    }
    return mixedFrames;
  }

  /** Supply-side counters, for HIL diagnosis. */
  debug(): Record<string, number> {
    return {
      silentSec: this.silence.silentSeconds,
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

  /**
   * Interleave one slice to S16, applying the crossfade gain and the listener's level together.
   *
   * This is the only place a sample is scaled, which is why the volume control belongs here rather
   * than anywhere further downstream: the samples handed to the pipeline are already the samples the
   * listener asked to hear, and nothing on the Android side is asked to change its own volume.
   *
   * Both gains are at most unity, so their product is too. That is what makes the control incapable
   * of clipping: it can only ever take away.
   */
  private interleave(planar: PlanarBuffer, offset: number, frames: number): Int16Array {
    const channels = planar.channels.length;
    // The pipeline's wire format is interleaved stereo, so a mono render is duplicated rather than
    // left to be read as two channels running at half speed.
    const outChannels = 2;
    const pcm = new Int16Array(frames * outChannels);
    const fadePerFrame = this.fade ? this.fade.perSecond / this.sampleRate : 0;
    const masterPerFrame = this.masterRamp ? this.masterRamp.perSecond / this.sampleRate : 0;
    let fadeGain = this.gain;
    let masterGain = this.masterGain;

    for (let frame = 0; frame < frames; frame += 1) {
      if (this.fade) {
        fadeGain += fadePerFrame;
        fadeGain = this.fade.perSecond >= 0 ? Math.min(fadeGain, this.fade.to) : Math.max(fadeGain, this.fade.to);
      }
      if (this.masterRamp) {
        masterGain += masterPerFrame;
        masterGain =
          this.masterRamp.perSecond >= 0
            ? Math.min(masterGain, this.masterRamp.to)
            : Math.max(masterGain, this.masterRamp.to);
      }
      const gain = fadeGain * masterGain;
      for (let channel = 0; channel < outChannels; channel += 1) {
        const source = planar.channels[Math.min(channel, channels - 1)];
        const value = Math.max(-1, Math.min(1, source[offset + frame] * gain));
        pcm[frame * outChannels + channel] = Math.round(value * (value < 0 ? INT16_SCALE : INT16_SCALE - 1));
      }
    }
    this.gain = fadeGain;
    this.masterGain = masterGain;
    this.converted = true;
    if (this.fade) {
      const done = this.fade.perSecond >= 0 ? fadeGain >= this.fade.to : fadeGain <= this.fade.to;
      if (done) this.fade = null;
    }
    if (this.masterRamp) {
      const done = this.masterRamp.perSecond >= 0 ? masterGain >= this.masterRamp.to : masterGain <= this.masterRamp.to;
      if (done) this.masterRamp = null;
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
      if (this.queue.length) {
        void this.pump();
        return;
      }
      // Nothing left to write. The depth still has to be read from time to time, because a pipeline
      // that has stopped consuming only shows itself by holding a depth that never falls — and the
      // pump, which is the only other caller that reads it, has already exited. Without this the
      // stall watchdog could never observe the state it exists to catch.
      if (this.opened && !this.suspended) {
        this.idleTicks += 1;
        if (this.idleTicks * TICK_MS >= IDLE_DEPTH_POLL_MS) {
          this.idleTicks = 0;
          void this.readQueuedSec();
        }
        return;
      }
      if (!this.endings.length && this.ticker !== null) {
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
      // `this.tail` keeps the loop alive on its own. The outgoing tune's audio only reaches the
      // speaker through this sink, and the incoming tune may be a second or two from rendering its
      // first chunk — so a loop that ran only while there was audio of its own to write left the
      // tail sitting unplayed and the listener heard the old tune, a gap, then the new one. During
      // that gap the tail IS the audio.
      while (!this.closed && (this.queue.length || this.tail)) {
        // Replaced. There is one AudioTrack, and two sinks writing to it do not mix — the slices
        // interleave and the listener hears the old tune, a fragment of the new one, the old tune
        // again, and so on. Being superseded therefore makes a sink inert: it stops writing as well
        // as leaving the track alone for its successor to close.
        if (isSuperseded(this.backend, this.serial)) {
          this.queue = [];
          this.endings = [];
          return;
        }
        if (this.suspended) {
          await new Promise((resolve) => setTimeout(resolve, PUMP_IDLE_MS));
          continue;
        }
        if (this.queuedSec * 1000 >= (this.transitioning ? TRANSITION_HIGH_WATER_MS : HIGH_WATER_MS)) {
          await new Promise((resolve) => setTimeout(resolve, PUMP_IDLE_MS));
          this.announceEndings();
          // Ask, do not guess.
          this.queuedSec = await this.readQueuedSec();
          continue;
        }
        if (!(await this.ensureOpen())) break;
        // Nothing of this tune's own yet, but a tail to carry: give the mixer an empty slice to
        // fold it into, so the outgoing tune keeps sounding until the incoming one can join it.
        const own = this.queue.shift();
        // Nothing of this tune's own yet, but a tail to carry: an empty slice for the mixer to fold
        // it into. Marked as not this tune's audio, which is what holds the fade back — see mixTail.
        const slice = own ?? (this.tail ? new Int16Array(this.tailSliceFrames * 2) : undefined);
        if (!slice) continue;
        await this.send(slice, own !== undefined);
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
      this.noteStats(stats);
      if (stats && typeof stats.bufferedMs === "number") {
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

  /**
   * The pipeline's cumulative underrun count, as AudioFlinger reports it.
   *
   * Cumulative since `openAudioTrack`, so it only ever rises within a tune; kept as a max so a
   * reordered or stale read cannot walk it backwards.
   */
  underruns(): number {
    return this.nativeUnderruns;
  }

  /** Take whatever the pipeline reported, from a write or a stats read. */
  private noteStats(stats: NativeAudioStats | undefined): void {
    if (!stats) return;
    if (typeof stats.bufferedMs === "number") this.noteDepth(stats.bufferedMs);
    if (typeof stats.underruns === "number") {
      this.nativeUnderruns = Math.max(this.nativeUnderruns, stats.underruns);
    }
  }

  /** Record a depth reading against the playhead, whatever call produced it. */
  private noteDepth(bufferedMs: number): void {
    this.queuedSec = Math.max(0, bufferedMs / 1000);
    this.playheadSec = this.writtenFrames / this.sampleRate - this.queuedSec;
    this.playheadAtMs = performance.now();
    this.watchDepth(bufferedMs);
  }

  /**
   * Notice a pipeline that has stopped consuming, and re-open it.
   *
   * `ensureOpen` short-circuits on `this.opened`, which is a belief held on the JavaScript side and
   * never checked against the pipeline it describes. When the native track stops — observed on the
   * Pixel 4 after a burst of rapid track changes — that belief stays true, the sink keeps handing
   * over audio nothing will play, and the elapsed clock keeps advancing because it is driven by the
   * written total rather than by anything audible. The result is a station that looks like it is
   * playing and is silent, and only relaunching the app cleared it.
   *
   * The signal is deliberately narrow. Once the queue has drained, a working pipeline must report a
   * falling depth, because nothing more is being written into it. A depth that does not fall over
   * {@link STALL_GRACE_MS} while there is audio buffered, playback is not suspended and nothing is
   * being written means the pipeline is not consuming. Anything looser risks firing while the pump
   * is legitimately holding the buffer at its high-water mark, and a watchdog that judges a healthy
   * pipeline is worse than none: this engine has been broken twice by one that judged seeks.
   */
  private watchDepth(bufferedMs: number): void {
    // "Nothing is going in" rather than "the pump is not running". The pump also sits still while
    // the buffer is above its high-water mark, polling for it to drain — which is exactly the state
    // a stalled pipeline holds it in, and the state the device was found in with twelve seconds
    // parked and nothing playing. Keying off the pump's own flag missed that case entirely.
    const quiet = performance.now() - this.lastWriteAtMs >= WRITE_QUIET_MS;
    if (this.closed || this.suspended || !this.opened || !quiet || bufferedMs <= 0) {
      this.depthStalledSinceMs = null;
      this.lastDepthMs = bufferedMs;
      return;
    }
    const draining = bufferedMs < this.lastDepthMs - DEPTH_PROGRESS_EPSILON_MS;
    this.lastDepthMs = bufferedMs;
    if (draining) {
      this.depthStalledSinceMs = null;
      return;
    }
    this.depthStalledSinceMs ??= performance.now();
    if (performance.now() - this.depthStalledSinceMs < STALL_GRACE_MS) return;
    this.depthStalledSinceMs = null;
    addLog("warn", "Native audio: pipeline stopped consuming; re-opening", {
      service: "local-sid",
      bufferedMs: Math.round(bufferedMs),
      writtenSec: Math.round(this.writtenFrames / this.sampleRate),
    });
    void this.reopenAfterStall();
  }

  /**
   * Drop the stalled track and let the next write open a fresh one.
   *
   * `writtenFrames` is rebased onto what was actually audible, because the playhead is derived from
   * it: leaving it at the total written into a track that never played would put the playhead
   * seconds ahead of the sound and the scheduler would read that as the audio having run out.
   */
  private async reopenAfterStall(): Promise<void> {
    if (this.closed || !this.opened) return;
    this.opened = false;
    this.opening = null;
    this.writtenFrames = Math.max(0, Math.round(this.playheadSec * this.sampleRate));
    this.queuedSec = 0;
    // Everything still queued went with the track, so the chunks it belonged to will never finish
    // playing and their completions would never be announced. The engine renders more only when it
    // is told a chunk is done, so leaving these outstanding trades a silent pipeline for a stalled
    // one — which is the failure this codebase has already been broken by twice. Rebasing
    // `writtenFrames` down to the playhead is what would have stranded them: `announceEndings`
    // fires on a clock clamped to what has been written.
    const orphaned = this.endings;
    this.endings = [];
    for (const entry of orphaned) entry.fire();
    try {
      openTracks.delete(this.backend);
      await this.backend.closeAudioTrack?.({});
    } catch (error) {
      addLog("debug", "Native audio: closing a stalled track failed; opening a new one anyway", {
        error: (error as Error)?.message ?? String(error),
      });
    }
    if (!this.closed) void this.pump();
  }

  private async send(slice: Int16Array, sliceIsOwnAudio = true): Promise<void> {
    // Fold the outgoing tune in before the slice leaves for the track: this is the only place both
    // tunes exist as PCM in one writer, which is what a crossfade needs.
    const mixedFrames = this.mixTail(slice, sliceIsOwnAudio);
    // A slice of this tune's own is always worth writing. One that exists only to carry the outgoing
    // tune is not: when the tail runs out partway through, the rest of that slice is silence, and
    // writing it puts a hole between the two tunes exactly where they were meant to join. Measured
    // as 50 ms of silence — one slice — in an otherwise continuous stream.
    if (!sliceIsOwnAudio && mixedFrames * 2 < slice.length) return;
    const bytes = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
    try {
      // Replaced while this write was already on its way. Dropping it here as well as in the pump
      // loop is what makes the handover atomic: without it a sink that had been superseded would
      // re-claim the track simply by writing, and the two would trade it back and forth — which is
      // the interleaving this exists to prevent.
      if (isSuperseded(this.backend, this.serial)) return;
      // Take the track with the first slice that actually goes to it.
      //
      // Not on construction: the engine builds the incoming tune's sink well before that tune has
      // rendered anything, and a sink that has been superseded stops writing at once. Claiming
      // early therefore silenced the outgoing tune while the incoming one was still a second or two
      // from its first sample, and the listener heard a gap where the crossfade should have been.
      //
      // Claiming on the first write hands over at the only moment that is both safe and seamless:
      // exactly one sink is ever writing, so the slices cannot interleave, and the outgoing tail
      // keeps the speaker fed right up to the instant the new tune has something to say.
      claimNativeTrack(this.backend, this, this.serial);
      if (this.writtenFrames === 0) {
        traceLocalSid("first-write", { serial: this.serial, tail: this.tail ? this.tail.frames : 0 });
      }
      const stats = await this.backend.writeAudioTrack({ data: toBase64(bytes) });
      this.lastWriteAtMs = performance.now();
      // Watched here rather than anywhere upstream: this is the last point the audio is still audio
      // and the only one that sees what the speaker was actually given.
      this.silence.observe(slice, slice.length / 2 / this.sampleRate);
      this.writtenFrames += slice.length / 2;
      this.lastBufferedMs = stats?.bufferedMs ?? this.lastBufferedMs;
      this.rememberWrite(slice);
      // The playhead is what has been written less what is still queued, which ties the clock to the
      // DAC rather than to wall time.
      this.noteDepth(stats?.bufferedMs ?? 0);
      this.noteStats(stats);
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
    const settings = {
      sampleRate: Math.round(this.sampleRate),
      bufferMs: TARGET_BUFFER_MS,
      maxRingMs: MAX_RING_MS,
      trackBursts: TRACK_BURSTS,
      primeMs: primeMs(),
    };
    // Adopt a track that is already running on these settings rather than replacing it. Settings are
    // compared rather than assumed equal: a tune at a different sample rate genuinely does need a
    // new track, and inheriting one would play it at the wrong speed.
    //
    // `primeMs` is deliberately left out of the comparison. It is how much audio to gather before a
    // track starts playing, derived from how fast this device has been rendering, so it changes as
    // the estimate improves — and a track that is already playing has no start left to prime. Left
    // in, the value drifting between two tunes was enough to make the second one replace the track
    // and cut the stream in two.
    const { primeMs: _primeMs, ...identity } = settings;
    const signature = JSON.stringify(identity);
    if (openTracks.get(this.backend) === signature) {
      this.opened = true;
      // Take the track here, not on the first write.
      //
      // This branch only runs from the pump loop with a slice ready to go, so it is the same moment
      // as the first write for every purpose the claim exists to serve — the outgoing tail has
      // already fed the speaker right up to this point. But it is one await earlier, and that await
      // is enough. Until the claim lands the previous opener is not superseded, so a `close()` on it
      // in the meantime passes its `mayTouchTrack` gate and runs `releaseNativeTrack`,
      // `openTracks.delete`, `flushAudioTrack` and `closeAudioTrack` — tearing down the very track
      // this sink has just decided to inherit. This sink still believes it is open, so its next
      // `ensureOpen` short-circuits and `send` writes into a destroyed track: the write throws, gets
      // logged, and the tune goes quiet until the silence detector notices.
      //
      // `claimNativeTrack` orders by serial, so a sink that has already been superseded cannot take
      // the track back by adopting it.
      claimNativeTrack(this.backend, this, this.serial);
      return Promise.resolve(true);
    }
    this.opening ??= withOpenDeadline(this.backend.openAudioTrack(settings))
      .then(() => {
        this.opened = true;
        openTracks.set(this.backend, signature);
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

  /**
   * Set the listener's level, ramping into it so the change is never a step.
   *
   * The crossfade is left exactly where it is. Mute is simply this with a target of zero, and
   * unmuting is the level going back to whatever the slider still reads — the slider's position is
   * held by the caller, so muting cannot lose it.
   */
  setMasterGain(value: number, rampMs = MASTER_RAMP_MS): void {
    const to = Math.max(0, Math.min(1, value));
    // Ask the pipeline to attenuate on its way out, where the change is heard almost at once.
    // Scaling at the conversion below is correct but slow: this sink keeps up to twenty seconds
    // scheduled ahead, so a level applied there reaches the speaker twenty seconds late, which is
    // not a volume control. Where the native path takes it, that becomes the one that matters and
    // the conversion below is left at unity so the two do not multiply.
    if (this.backend.setAudioTrackGain && this.nativeGainAvailable) {
      void this.backend
        .setAudioTrackGain({ gain: to })
        .then(() => {
          // Only now is the pipeline holding the level, so only now may the conversion stand down.
          // Standing it down before the call resolved was a way to lose the level entirely: a
          // rejection arriving later left the conversion at unity with nothing attenuating, and the
          // listener heard full volume until they happened to move the slider again.
          this.masterRamp = null;
          this.masterGain = 1;
        })
        .catch((error) => {
          addLog("warn", "Native audio: pipeline gain rejected; attenuating at the conversion instead", {
            service: "local-sid",
            gain: to,
            error: (error as Error)?.message ?? String(error),
          });
          this.nativeGainAvailable = false;
          this.rampConversionGain(to, rampMs);
        });
      return;
    }
    this.rampConversionGain(to, rampMs);
  }

  /**
   * Attenuate where the samples are converted, which is where the level lands when the pipeline
   * cannot take it. Correct, but heard only once the twenty seconds already scheduled have played
   * out — which is why it is the fallback rather than the way this normally works.
   */
  private rampConversionGain(to: number, rampMs: number): void {
    if (rampMs <= 0 || !this.converted) {
      this.masterRamp = null;
      this.masterGain = to;
      return;
    }
    if (to === this.masterGain) {
      this.masterRamp = null;
      return;
    }
    this.masterRamp = { to, perSecond: ((to - this.masterGain) * 1000) / rampMs };
  }

  /** Move the crossfade gain — the blend between two tunes — leaving the listener's level alone. */
  fadeTo(target: number, ms: number): void {
    const to = Math.max(0, Math.min(1, target));
    if (ms <= 0) {
      this.fade = null;
      this.gain = to;
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
    // Superseded: the audio in the track belongs to the tune that replaced this one.
    if (isSuperseded(this.backend, this.serial)) return;
    void this.backend.flushAudioTrack?.().catch((error) => {
      addLog("warn", "Native audio: flush failed", { error: (error as Error)?.message ?? String(error) });
    });
  }

  suspend(): void {
    // Freeze the clock where it stands, so nothing scheduled against it is judged late on resume.
    this.playheadSec = this.currentTime;
    this.suspended = true;
    // The ring holds a couple of seconds, which would otherwise keep sounding after a pause.
    this.queue = [];
    // And the completions owed for it. The audio those entries describe has just been thrown away,
    // so their `at` times are now in a future the playhead will still reach — each would announce a
    // chunk that never played. The engine counts those announcements against what it scheduled to
    // decide the tune is over, so a few pause/resume cycles would let the count run ahead and end
    // the track early. Discarded, not orphaned: unlike `reopenAfterStall` there is nothing to
    // rescue, because the scheduler is not being asked to refill from here.
    this.endings = [];
    // Rebase the write counter onto what was actually heard, exactly as the other two paths that
    // discard audio do (`flush` and `reopenAfterStall`). The playhead is derived as
    // "written minus still queued", so throwing audio away while leaving it counted as written puts
    // the playhead that far ahead of the sound — and on resume the pump writes the audio that piled
    // up during the pause on top of an already-overstated base. Measured on a Pixel 4: pausing for
    // twelve seconds made the transport clock jump forward by about eight the moment it resumed.
    this.writtenFrames = Math.max(0, Math.round(this.playheadSec * this.sampleRate));
    this.queuedSec = 0;
    void this.backend.flushAudioTrack?.().catch((error) => {
      // A pipeline that has already gone has nothing to flush, so this is not fatal — but it is
      // still worth a line, because a flush that fails on a live track leaves the paused audio in it.
      addLog("warn", "Native audio: flush on suspend failed", {
        error: (error as Error)?.message ?? String(error),
      });
    });
  }

  resume(): void {
    if (!this.suspended) return;
    this.playheadAtMs = performance.now();
    this.suspended = false;
    void this.pump();
  }

  /**
   * Stop feeding the track, but leave the track itself running.
   *
   * Used when this tune's remaining audio has been handed to the next one. `close` is wrong here:
   * this sink has not been superseded yet — the incoming tune claims the track on its first write,
   * which is still a moment away — so `close` would find the track still its own and flush it. That
   * discards the audio already committed to the pipeline, which is exactly what was bridging the
   * hundred milliseconds until the next tune writes. Measured on a Pixel 4 as a short but plainly
   * audible hole in the middle of an otherwise correct crossfade.
   *
   * The track therefore keeps playing what it holds, and the next sink writes straight onto the end
   * of it: one continuous stream of samples from one tune to the next.
   */
  releaseForHandover(): void {
    this.closed = true;
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.queue = [];
    this.endings = [];
    this.history = [];
    this.historyFrames = 0;
  }

  close(): void {
    this.closed = true;
    // Local teardown happens either way: this sink is finished with, whoever owns the track.
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.queue = [];
    this.endings = [];
    // Tear the track down only if it is still ours to tear down. A sink that never wrote owns
    // nothing but may still have opened a track, and closing that is right; one that has been
    // replaced must leave its successor's track alone.
    const mayTouchTrack = !isSuperseded(this.backend, this.serial);
    this.opened = false;
    if (!mayTouchTrack) return;
    releaseNativeTrack(this.backend, this);
    openTracks.delete(this.backend);
    void this.backend.flushAudioTrack?.().catch((error) => {
      // Nothing queued, or no pipeline left to queue into. Logged rather than ignored so a device
      // whose track has stopped responding leaves a trail before the close below fails too.
      addLog("warn", "Native audio: flush on close failed", {
        error: (error as Error)?.message ?? String(error),
      });
    });
    void this.backend.closeAudioTrack().catch((error) => {
      // Closing a track that is already gone is expected; any other failure means the track is
      // still holding the device, which is what the next open will trip over.
      addLog("warn", "Native audio: close failed", {
        error: (error as Error)?.message ?? String(error),
      });
    });
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
/**
 * Which sink may act on the one shared native track.
 *
 * There is a single AudioTrack, and each tune gets a fresh sink object over it. A crossfade keeps
 * the outgoing sink alive so its tail can ring out under the incoming tune and closes it on a timer
 * — `crossfadeMs + 50`, which with the default 1.5 s fade lands a second and a half into the new
 * tune. Without this, that close flushed and closed the shared track, throwing away the audio the
 * new tune had queued and stopping its output: measured on a Pixel 4, every other Next left the
 * track silent after a fraction of a second.
 *
 * So a superseded sink becomes inert: it stops writing, and it leaves the track for its successor
 * to close. Everything local to it — ticker, queue, its own flag — is torn down either way. It must
 * stop writing as well as stop closing, because one AudioTrack cannot carry two streams: the slices
 * interleave, and the listener hears the old tune, a fragment of the new one, the old tune again,
 * and so on.
 *
 * Keyed by the backend rather than held in one global, because ownership is of one track and two
 * sinks over two different backends are not in competition. Production has a single backend, so it
 * is the same thing there.
 */
/**
 * Which backends already have a track open, and with what settings.
 *
 * There is one native track shared by every tune, and a fresh sink starts out believing it has to
 * open one. Opening a track that is already running tears it down and builds it again, which
 * discards whatever the outgoing tune had committed — heard as a hole of about 100 ms at the seam of
 * an otherwise correct crossfade. A sink that inherits a track opened with the same settings
 * therefore writes straight onto the end of it, and the stream of samples never stops.
 */
/**
 * How long the platform gets to open the AudioTrack before the attempt is abandoned.
 *
 * `openAudioTrack` is a Capacitor call, and Capacitor delivers a plugin result by evaluating
 * JavaScript in the page — so a hidden WebView suspends the result indefinitely rather than
 * failing it. `pump()` awaits `ensureOpen()` inside its `try`, so an open that never settles means
 * the `finally` that clears `pumping` never runs, and no later pump can start: the tune goes silent
 * for the rest of the session with the transport still reporting playback. Opening a track is a
 * millisecond-scale operation, so a deadline this long only ever fires on that stall.
 */
const OPEN_TRACK_TIMEOUT_MS = 5000;

/** Reject an open that has not settled within {@link OPEN_TRACK_TIMEOUT_MS}. */
const withOpenDeadline = <T>(attempt: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the platform did not open an AudioTrack within ${OPEN_TRACK_TIMEOUT_MS}ms`)),
      OPEN_TRACK_TIMEOUT_MS,
    );
    attempt.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });

const openTracks = new WeakMap<object, string>();

const trackOwners = new WeakMap<object, { sink: object; serial: number }>();
let nextSinkSerial = 1;

/** A sink's place in the order they were created. Later beats earlier. */
const nextSerial = (): number => nextSinkSerial++;

/**
 * Take the track, if this sink is not already behind a newer one.
 *
 * Called from the write path rather than from the constructor, and ordered by age rather than by
 * who got there last. Both matter:
 *
 * - Claiming at construction silenced the outgoing tune the moment the incoming sink existed, which
 *   is a second or two before that tune has rendered anything — heard as a gap where the crossfade
 *   should be.
 * - Claiming unconditionally on write let the outgoing sink take the track straight back, so the
 *   two traded it and their slices interleaved.
 *
 * Ordering by serial gives the handover the app actually wants: the outgoing tail keeps the speaker
 * fed right up to the incoming tune's first sample, and from that sample on the older sink is
 * finished.
 */
const claimNativeTrack = (backend: object, sink: object, serial: number): void => {
  const owner = trackOwners.get(backend);
  if (owner && owner.serial > serial) return;
  trackOwners.set(backend, { sink, serial });
};

/** Whether a NEWER sink has already begun writing, which is what retires this one. */
const isSuperseded = (backend: object, serial: number): boolean => {
  const owner = trackOwners.get(backend);
  return owner !== undefined && owner.serial > serial;
};

const releaseNativeTrack = (backend: object, sink: object): void => {
  if (trackOwners.get(backend)?.sink === sink) trackOwners.delete(backend);
};

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
    audioUnderruns: () => sink.underruns(),
    isSilentFault: () => sink.isSilentFault(),
    takeCrossfadeTail: (seconds: number) => sink.takeTail(seconds),
    beginCrossfadeTailPlayout: (seconds: number) => sink.beginTailPlayout(seconds),
    releaseForHandover: () => sink.releaseForHandover(),
    adoptCrossfadeTail: (slices: Int16Array[], seconds: number) => sink.adoptTail(slices, seconds),
    resetSilence: () => sink.resetSilence(),
    resume: () => sink.resume(),
    suspend: () => sink.suspend(),
    fadeOut: (ms: number) => sink.fadeTo(0, ms),
    // A tune opening at the listener's level: the level is the master, the blend is the fade. Setting
    // the master outright rather than ramping into it is what the engine has always done here, and it
    // is right — this runs before the new tune's first sample, so there is nothing to click against.
    //
    // The blend has to *start* at silence. A fresh sink's fade gain is already 1, so ramping it "to
    // 1" changed nothing and the incoming tune arrived at full level while the outgoing one faded
    // away underneath it — a crossfade on one side only, described from the room as the next tune
    // suddenly kicking in. Dropped to zero first, the two ramps are the two halves of one crossfade:
    // this gain is applied when a slice is converted, and the outgoing tune is summed in afterwards
    // with its own falling ramp, so one rises exactly as the other falls.
    //
    // Both ramps advance per converted frame rather than by the clock, so neither moves while this
    // tune has nothing of its own to play and the blend always spans its real first seconds.
    fadeIn: (ms: number, toGain = 1) => {
      sink.setMasterGain(toGain, 0);
      if (ms > 0) sink.fadeTo(0, 0);
      sink.fadeTo(1, ms);
    },
    setGain: (value: number) => sink.setMasterGain(value),
    flush: () => sink.flush(),
    close: () => sink.close(),
  };
};
