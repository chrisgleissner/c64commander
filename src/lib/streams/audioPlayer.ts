/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability D — WebAudio player for the mirrored device audio.
 *
 * Schedules de-interleaved stereo chunks back-to-back with an ~80 ms lead-in for
 * gapless playback. The AudioContext is injected so the scheduling can be unit
 * tested without a real audio device.
 */

import { addLog } from "@/lib/logging";
import { AUDIO_SAMPLE_RATE, deinterleaveStereo } from "./audioStream";

export const AUDIO_LEAD_IN_SECONDS = 0.08;

/** The next chunk start time: never in the past, never overlapping the previous chunk. */
export const nextStartTime = (currentTime: number, previousEnd: number, leadIn = AUDIO_LEAD_IN_SECONDS): number =>
  Math.max(currentTime + leadIn, previousEnd);

/** Minimal structural subset of AudioContext this player relies on. */
export interface MinimalAudioContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  resume?(): Promise<void>;
  close?(): Promise<void>;
}

export type AudioContextFactory = () => MinimalAudioContext;

const defaultFactory: AudioContextFactory = () => {
  const Ctor =
    (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("WebAudio is not available in this environment.");
  return new Ctor() as unknown as MinimalAudioContext;
};

export class AudioMirrorPlayer {
  private ctx: MinimalAudioContext | null = null;
  private nextTime = 0;
  private scheduled = 0;
  private underruns = 0;

  constructor(
    private readonly factory: AudioContextFactory = defaultFactory,
    private readonly leadIn: number = AUDIO_LEAD_IN_SECONDS,
    private readonly sampleRate: number = AUDIO_SAMPLE_RATE,
  ) {}

  /** Lazily create/resume the context. Returns false when WebAudio is unavailable. */
  async start(): Promise<boolean> {
    if (!this.ctx) {
      try {
        this.ctx = this.factory();
      } catch (error) {
        // WebAudio genuinely unavailable (e.g. no AudioContext, autoplay policy). Log the reason
        // so the caller's "audio unavailable" state is diagnosable rather than a silent false.
        addLog("warn", "Audio Mirror: WebAudio context unavailable; audio playback disabled", {
          error: (error as Error)?.message ?? String(error),
        });
        return false;
      }
      this.nextTime = 0;
      this.underruns = 0;
    }
    await this.ctx.resume?.();
    return true;
  }

  /** Schedule one interleaved-stereo S16 chunk. No-op if not started or empty. */
  playChunk(interleaved: Int16Array): void {
    if (!this.ctx) return;
    const { left, right, frames } = deinterleaveStereo(interleaved);
    if (frames === 0) return;
    // Underrun detection: if the previously-scheduled audio has already fully drained by the time
    // this chunk is scheduled (nextTime has fallen at/behind the audio clock), the output ran dry —
    // an audible gap. This is the closest the WebAudio player path can get to a hardware-callback
    // underrun; it is the governor's fast-demote trigger and a §16.2 counter (labelled a *player*
    // underrun, not a native RT-callback underrun).
    if (this.nextTime > 0 && this.nextTime <= this.ctx.currentTime) this.underruns += 1;
    const buffer = this.ctx.createBuffer(2, frames, this.sampleRate);
    buffer.getChannelData(0).set(left);
    buffer.getChannelData(1).set(right);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const start = nextStartTime(this.ctx.currentTime, this.nextTime, this.leadIn);
    source.start(start);
    this.nextTime = start + frames / this.sampleRate;
    this.scheduled += 1;
  }

  get scheduledChunks(): number {
    return this.scheduled;
  }

  /**
   * Player buffer depth ahead of the audio output clock (ms) — how much scheduled audio is still to
   * play. The governor's primary headroom signal; trends toward 0 as the pipeline nears an underrun.
   * 0 when not started or already drained.
   */
  get bufferedMs(): number {
    if (!this.ctx) return 0;
    return Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
  }

  /** Cumulative player underruns (output ran dry between chunks) since {@link start}. */
  get underrunCount(): number {
    return this.underruns;
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    this.nextTime = 0;
    this.scheduled = 0;
    this.underruns = 0;
    await ctx?.close?.();
  }
}
