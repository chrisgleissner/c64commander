/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { AudioScheduleSink, AudioScheduleSource } from "./localSidChunkScheduler";
import type { SidRendererId } from "./sidRenderer/sidRendererAvailability";
import { LocalSidUnavailableError } from "./sidRenderer/rendererFactory";

/** An audio sink instance plus its teardown. */
export interface LocalSidAudioSink {
  sink: AudioScheduleSink;

  /**
   * Cumulative underruns the OUTPUT itself reported, where the sink can see them.
   *
   * The chunk scheduler counts a chunk handed over after the previous one finished, which is the
   * right measure for the Web Audio sink because there the schedule *is* the output. The native sink
   * writes into a ring the speaker drains on its own thread, so the ring can run dry while every
   * chunk was handed over on time — the scheduler sees nothing and the listener hears a gap. That is
   * the shape of defect this repo has already been caught by once (AGENTS.md, "Diagnostics that
   * cannot report the fault"), so the pinned `audioUnderruns` budget takes the worse of the two.
   */
  audioUnderruns?: () => number;
  /** Resume a suspended context (browsers start suspended until a gesture). */
  resume?: () => Promise<void> | void;
  /** Suspend the audio clock, freezing the schedule where it stands. */
  suspend?: () => Promise<void> | void;
  /** Ramp output down over `ms`, for an opt-in crossfade. */
  fadeOut?: (ms: number) => void;
  /**
   * Ramp output up over `ms`, for an opt-in crossfade.
   *
   * `toGain` is where the ramp ENDS. It is not optional in practice: ramping to
   * a hardcoded 1 wiped whatever level the listener had chosen, so the volume
   * control worked until the next crossfade and then jumped back to full.
   */
  fadeIn?: (ms: number, toGain?: number) => void;
  /** Set output level, 0..1. Used by the Play page's volume control. */
  setGain?: (value: number) => void;
  /**
   * Whether the speaker has been handed a flat signal for long enough to be a fault.
   *
   * The invariant is "no silent playback unless the listener asked for silence". Every other
   * counter here describes supply and demand — frames written, buffer depth, underruns — and all of
   * them look perfectly healthy while a tune renders a flat line. See `SilenceDetector`.
   */
  isSilentFault?: () => boolean;
  /** Judge the next stretch afresh: a new tune, a resume, or a recovery just attempted. */
  resetSilence?: () => void;
  /**
   * Hand over audio rendered but not yet played, so the next tune can fade it out underneath itself.
   *
   * A crossfade needs both tunes sounding at once and there is only one output. Two sinks writing to
   * it interleave rather than mix, and a sink's gain ramp is applied when a slice is converted, so it
   * cannot reach audio already converted. The incoming sink therefore does the mixing.
   */
  takeCrossfadeTail?: (seconds: number) => CrossfadeTail;
  /**
   * Start a track change: recover this tune's unplayed audio and keep playing it from JS.
   *
   * `seconds` is the whole budget — long enough to cover opening the next tune and then to fade
   * under it — because this is the only audio there is until the next tune renders a sample.
   *
   * With `playOutDeclickSeconds` above zero the tune is ending by itself instead: `seconds` is what is
   * left of it, it ends there over that declick, and the next tune plays it whole before its own audio.
   */
  beginCrossfadeTailPlayout?: (seconds: number, playOutDeclickSeconds?: number) => void;
  /** Stop feeding the shared track without tearing it down, so the next tune writes onto the end. */
  releaseForHandover?: () => void;
  /** Call `listener` once, when this sink's own first sample has been heard, after a predecessor's play-out. */
  onOwnAudioHeard?: (listener: () => void) => void;
  /** Sum a predecessor's tail under this sink's own output, fading it away across `seconds`. */
  adoptCrossfadeTail?: (tail: CrossfadeTail, seconds: number) => void;
  /**
   * Throw away audio already handed to the output, for a seek.
   *
   * Web Audio needs nothing here — stopping the scheduled sources is enough. A native sink does:
   * it holds seconds of audio the speaker has not reached yet, so without this a seek would go on
   * playing the old position for as long as that buffer is deep. That is what broke fast-forward,
   * rewind and the progress bar when on-device playback moved to the native path.
   */
  flush?: () => void;
  close: () => void;
}

export type LocalSidAudioSinkFactory = (sampleRate: number, renderer?: SidRendererId) => LocalSidAudioSink;

/**
 * What one sink hands the next for a crossfade. The native sink's tail stays on the native side and
 * is named by an id; the shape is the sink's own business, the engine only passes it along.
 */
export interface CrossfadeTail {
  readonly frames: number;
}

/**
 * A gain ramp that could not be scheduled has already been replaced by a direct assignment, so the
 * listener still hears the right level — but the CLICK the ramp existed to avoid is now audible,
 * and a fade that silently became a step is exactly the kind of thing that gets blamed on the SID
 * engine. Logged at debug: it is recoverable, and on a busy AudioContext it can repeat.
 */
const reportGainSchedulingFailure = (operation: string, error: unknown): void => {
  addLog("debug", "Local SID audio: gain ramp could not be scheduled, set directly instead", {
    service: "local-sid",
    operation,
    error: (error as Error)?.message ?? String(error),
  });
};

export const webAudioSinkFactory: LocalSidAudioSinkFactory = (sampleRate: number) => {
  const Ctor =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new LocalSidUnavailableError("No AudioContext in this environment");
  const context = new Ctor({ sampleRate });
  // Everything plays through one gain node so a switchover can fade the whole
  // output, rather than each buffer source having to be faded individually.
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);
  const sink: AudioScheduleSink = {
    get currentTime() {
      return context.currentTime;
    },
    get sampleRate() {
      return context.sampleRate;
    },
    createBuffer: (channels, frames, rate) => context.createBuffer(channels, frames, rate),
    createSource: (buffer) => {
      const source = context.createBufferSource();
      source.buffer = buffer as AudioBuffer;
      source.connect(master);
      // AudioBufferSourceNode satisfies the narrow AudioScheduleSource slice we
      // use (start/stop/onended); the DOM onended signature differs only in its
      // (ignored) event arg.
      return source as unknown as AudioScheduleSource;
    },
  };
  return {
    sink,
    resume: () => context.resume(),
    suspend: () => context.suspend(),
    fadeOut: (ms: number) => {
      // Ramp to (near) zero, then let the caller close once the ramp has run.
      // linearRampToValueAtTime needs a starting event to ramp from, hence the
      // explicit setValueAtTime at "now".
      const now = context.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.0001, now + ms / 1000);
      } catch (error) {
        reportGainSchedulingFailure("fadeOut", error);
        master.gain.value = 0;
      }
    },
    setGain: (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      try {
        master.gain.cancelScheduledValues(context.currentTime);
        // A short ramp rather than a step: an abrupt gain change on a running
        // buffer is an audible click.
        master.gain.setValueAtTime(master.gain.value, context.currentTime);
        master.gain.linearRampToValueAtTime(clamped, context.currentTime + 0.02);
      } catch (error) {
        reportGainSchedulingFailure("setGain", error);
        master.gain.value = clamped;
      }
    },
    fadeIn: (ms: number, toGain = 1) => {
      const now = context.currentTime;
      const target = Math.min(1, Math.max(0.0001, toGain));
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(0.0001, now);
        master.gain.linearRampToValueAtTime(target, now + ms / 1000);
      } catch (error) {
        reportGainSchedulingFailure("fadeIn", error);
        master.gain.value = target;
      }
    },
    close: () => void context.close(),
  };
};
