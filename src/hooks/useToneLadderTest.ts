/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { addLog } from "@/lib/logging";
import { getC64API } from "@/lib/c64api";
import { AUDIO_SAMPLE_RATE } from "@/lib/streams/audioStream";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { VIC_FRAME_WIDTH } from "@/lib/streams/vicDecode";
import {
  TONE_LADDER_LOOP_SECONDS,
  TONE_LADDER_SLOT_SECONDS,
  detectFundamentalHz,
  gradeToneLadder,
  toneLadderSidBytes,
  type ToneLadderNoteInput,
  type ToneLadderResult,
} from "@/lib/streams/toneLadder";

/**
 * The tone & colour ladder, measured on the audio and video that actually arrive.
 *
 * Audio gives pitch, note timing and the noise floor; video gives the background colour, which
 * identifies each slot uniquely and therefore times the picture against the sound. The machine
 * writes both in one instruction sequence, so whatever gap turns up here belongs to the transport.
 *
 * The DSP mirrors `tools/hil/analyse_tone_ladder.py` step for step, deliberately: when the in-app
 * number and the HIL number disagree, the disagreement should be about the signal, not about two
 * different definitions of an onset.
 */

/** Analysis frame; short enough to place an onset, long enough for a stable level. */
const FRAME_SECONDS = 0.01;
/** A new note is a level step at least this far above the preceding frames. */
const ONSET_STEP_DB = 6;
/** Ignore steps closer together than this — ripple inside one note, not a new one. */
const MIN_NOTE_SECONDS = 0.2;
/** How far below a sounding note a frame must sit to count as quiet. */
const QUIET_BELOW_NOTE_DB = 20;
/** A ladder silence is a whole slot; a note boundary is only 80 ms. 0.3 s separates them. */
const SILENCE_MIN_SECONDS = 0.3;
/**
 * Long enough to hold a whole loop no matter where it is joined: two landmarks per 9 s loop means
 * at most ~4.5 s to reach one, plus a full loop after it, plus margin.
 */
const CAPTURE_SECONDS = 16;
/** AC-couple before measuring level; see acCouple(). */
const HIGHPASS_HZ = 60;

const dbOf = (value: number): number => 20 * Math.log10(Math.max(value, 1e-12));

/**
 * 2nd-order Butterworth high-pass — the first stage of the measurement chain.
 *
 * Level measured on a signal that still carries DC is meaningless, which is why ITU-R BS.1770's
 * K-weighting begins with a high-pass. Here it is concrete: gating the SID leaves a DC step that
 * rings through the chip's DC blocker at around 1 Hz, and unweighted that ring measured -13 dBFS —
 * louder than half the ladder — so a plain RMS envelope scored it as a note. At 60 Hz it is gone,
 * and the lowest note in the ladder (C3, 130.8 Hz) loses 0.2 dB.
 */
export const acCouple = (samples: Float32Array, sampleRate: number, fc = HIGHPASS_HZ): Float32Array => {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cosW0 = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 + cosW0) / 2 / a0;
  const b1 = -(1 + cosW0) / a0;
  const b2 = b0;
  const a1 = (-2 * cosW0) / a0;
  const a2 = (1 - alpha) / a0;

  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x0 = samples[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
};

const rms = (samples: Float32Array, from: number, to: number): number => {
  let sum = 0;
  const end = Math.min(to, samples.length);
  for (let i = from; i < end; i += 1) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, end - from));
};

const quantile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))] ?? 0;
};

/**
 * Place an onset to about a millisecond instead of to the 10 ms analysis frame.
 *
 * The threshold is referenced to the NOTE — half power, 6 dB below its own plateau — not to the
 * midpoint between the note and whatever preceded it. Midpoint made the answer depend on how quiet
 * the preceding region was, so notes following a silence were called tens of milliseconds earlier
 * than notes following another note: a bias manufactured by the ladder's own structure. Half power
 * is the same place on every attack.
 *
 * Windows are ~8 ms and overlap, because a shorter window at C3 (130.8 Hz, a 7.6 ms period) tracks
 * the waveform's phase rather than its amplitude. Timestamps refer to the window CENTRE, so the
 * smoothing does not bias the result late and show up as a constant A/V offset that is really an
 * artefact of the measurement.
 */
export const refineOnsetSeconds = (samples: Float32Array, sampleRate: number, frameIndex: number): number => {
  const frameLength = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const gridSeconds = (frameIndex * frameLength) / sampleRate;
  const start = Math.max(0, (frameIndex - 5) * frameLength);
  const end = Math.min(samples.length, (frameIndex + 12) * frameLength);
  const hop = Math.max(1, Math.round(sampleRate * 0.001));
  const span = Math.max(hop * 2, Math.round(sampleRate * 0.008));
  const guard = 30; // 30 ms of context either side
  const steps = Math.floor((end - start - span) / hop) + 1;
  if (steps < guard * 2 + 4) return gridSeconds;

  const levels: number[] = [];
  for (let i = 0; i < steps; i += 1) levels.push(dbOf(rms(samples, start + i * hop, start + i * hop + span)));

  const before = quantile(levels.slice(0, guard), 0.5);
  const after = quantile(levels.slice(-guard), 0.5);
  if (after - before < ONSET_STEP_DB) return gridSeconds;

  const threshold = after - 6;
  let crossed = guard;
  while (crossed < steps && levels[crossed]! < threshold) crossed += 1;
  if (crossed >= steps) return gridSeconds;
  return (start + crossed * hop + span / 2) / sampleRate;
};

export interface SegmentedLadder {
  notes: ToneLadderNoteInput[];
  silences: { rmsDbfs: number; peakDbfs: number }[];
}

/**
 * Split a captured mono buffer into sounding notes and ladder silences.
 *
 * Segmentation is by note ONSET, not by the quiet between notes: a gated-off SID note still rings
 * through its release and only ducks by a few dB, so silence is not a reliable boundary while the
 * attack is a clean step. Timing is then taken as the INTER-ONSET INTERVAL rather than as how long
 * a note stays audible — a note is gated off 80 ms before its slot ends and that release is shaped
 * by whatever is downstream, so "how long was it audible" would measure the speaker as much as the
 * signal. Onset to onset is a clock.
 */
export const segmentNotes = (raw: Float32Array, sampleRate: number, startedAtMs = 0): SegmentedLadder => {
  const empty: SegmentedLadder = { notes: [], silences: [] };
  const samples = acCouple(raw, sampleRate);
  const frameLength = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frames = Math.floor(samples.length / frameLength);
  if (frames < 8) return empty;

  const levels: number[] = [];
  for (let i = 0; i < frames; i += 1) levels.push(dbOf(rms(samples, i * frameLength, (i + 1) * frameLength)));

  const quietBelow = quantile(levels, 0.9) - QUIET_BELOW_NOTE_DB;
  const active = levels.map((level) => level > quietBelow);
  // A note sustains; a click does not. Requiring the level to STAY up rejects the transient left by
  // gating the SID, which otherwise scores as an onset and shifts the whole alignment by one slot.
  const sustainFrames = Math.max(1, Math.round(0.15 / FRAME_SECONDS));

  const onsets: number[] = [];
  for (let i = 3; i < frames; i += 1) {
    if (!active[i]) continue;
    const previous = Math.max(levels[i - 1]!, levels[i - 2]!, levels[i - 3]!);
    if (levels[i]! - previous < ONSET_STEP_DB) continue;
    if (onsets.length && (i - onsets[onsets.length - 1]!) * FRAME_SECONDS <= MIN_NOTE_SECONDS) continue;
    let held = 0;
    for (let j = i; j < Math.min(frames, i + sustainFrames); j += 1) if (active[j]) held += 1;
    if (held / Math.min(sustainFrames, frames - i) < 0.6) continue;
    onsets.push(i);
  }
  if (onsets.length < 2) return empty;

  // Runs of quiet long enough to be a ladder silence rather than a note boundary.
  const silences: { rmsDbfs: number; peakDbfs: number }[] = [];
  let runStart: number | null = null;
  for (let i = 0; i <= frames; i += 1) {
    const quiet = i < frames && !active[i];
    if (quiet && runStart === null) runStart = i;
    else if (!quiet && runStart !== null) {
      if ((i - runStart) * FRAME_SECONDS >= SILENCE_MIN_SECONDS) {
        // Middle 60% avoids the previous note's release tail and the next note's attack.
        const from = Math.round((runStart + (i - runStart) * 0.2) * frameLength);
        const to = Math.round((runStart + (i - runStart) * 0.8) * frameLength);
        let peak = 0;
        for (let s = from; s < Math.min(to, samples.length); s += 1) peak = Math.max(peak, Math.abs(samples[s]!));
        silences.push({ rmsDbfs: dbOf(rms(samples, from, to)), peakDbfs: dbOf(peak) });
      }
      runStart = null;
    }
  }

  const refined = onsets.map((frame) => refineOnsetSeconds(samples, sampleRate, frame));
  const notes: ToneLadderNoteInput[] = [];
  for (let i = 0; i < refined.length - 1; i += 1) {
    const from = Math.round(refined[i]! * sampleRate);
    const to = Math.round(refined[i + 1]! * sampleRate);
    // Middle 60% skips the attack transient and any release tail.
    const inner = samples.subarray(
      from + Math.floor((to - from) * 0.2),
      Math.min(samples.length, from + Math.floor((to - from) * 0.8)),
    );
    const seconds = refined[i + 1]! - refined[i]!;
    if (seconds < 0.12) continue;
    notes.push({ hz: detectFundamentalHz(inner, sampleRate), seconds, atMs: startedAtMs + refined[i]! * 1000 });
  }
  return { notes, silences };
};

/**
 * The palette index the screen background is showing, as the mode over a grid of interior pixels.
 *
 * Sampled well inside the picture so the border — held black for the whole tune — cannot be
 * mistaken for the background, and taken as a mode over many points so a character glyph or a
 * decode glitch cannot outvote the colour that fills the screen.
 */
export const sampleBackgroundColour = (frame: Uint8Array, height: number): number => {
  const counts = new Uint16Array(16);
  const left = 64;
  const right = Math.min(VIC_FRAME_WIDTH - 64, 320);
  const top = Math.round(height * 0.25);
  const bottom = Math.round(height * 0.75);
  for (let y = top; y < bottom; y += Math.max(1, Math.round((bottom - top) / 16))) {
    for (let x = left; x < right; x += Math.max(1, Math.round((right - left) / 16))) {
      const pixel = y * VIC_FRAME_WIDTH + x;
      const byteIndex = pixel >> 1;
      if (byteIndex >= frame.length) continue;
      const byte = frame[byteIndex]!;
      counts[pixel & 1 ? byte >> 4 : byte & 0x0f]! += 1;
    }
  }
  let best = 0;
  for (let i = 1; i < 16; i += 1) if (counts[i]! > counts[best]!) best = i;
  return best;
};

export interface ToneLadderTest {
  running: boolean;
  result: ToneLadderResult | null;
  error: string | null;
  run: () => Promise<void>;
  reset: () => void;
}

export const useToneLadderTest = (session?: AvMirrorSession): ToneLadderTest => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToneLadderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const collecting = useRef(false);
  const captured = useRef<number[]>([]);
  const audioStartMs = useRef<number | null>(null);
  const colourChanges = useRef<{ colour: number; atMs: number }[]>([]);
  const pendingColour = useRef<{ colour: number; atMs: number } | null>(null);
  const lastColour = useRef<number | null>(null);
  const unsubscribeAudio = useRef<(() => void) | null>(null);
  const unsubscribeFrames = useRef<(() => void) | null>(null);

  const stopListening = useCallback(() => {
    collecting.current = false;
    unsubscribeAudio.current?.();
    unsubscribeAudio.current = null;
    unsubscribeFrames.current?.();
    unsubscribeFrames.current = null;
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  const finish = useCallback(() => {
    stopListening();
    const mono = Float32Array.from(captured.current);
    captured.current = [];
    const { notes, silences } = segmentNotes(mono, AUDIO_SAMPLE_RATE, audioStartMs.current ?? 0);
    const graded = gradeToneLadder(notes, { silences, colourChanges: colourChanges.current });
    setResult(graded);
    setRunning(false);
    addLog("info", "Tone & colour ladder: measured", {
      service: "streams",
      notes: notes.length,
      inTunePct: graded.inTunePct,
      medianCents: graded.medianCentsError,
      silenceFloorDbfs: graded.silence.floorDbfs,
      avOffsetMs: graded.av.medianOffsetMs,
      avVerdict: graded.av.verdict,
      colourChanges: graded.colour.changes,
    });
  }, [stopListening]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    captured.current = [];
    colourChanges.current = [];
    pendingColour.current = null;
    lastColour.current = null;
    audioStartMs.current = null;
    try {
      const bytes = toneLadderSidBytes();
      // Copy into a fresh buffer: the Blob must own bytes that cannot be recycled underneath it.
      await getC64API().playSidUpload(
        new Blob([bytes.slice()], { type: "application/octet-stream" }),
        undefined,
        undefined,
        { filename: "tone-ladder.sid" },
      );

      collecting.current = true;
      // Without a session there is nothing to listen to; the timeout below still fires and grades an
      // empty capture, which reports "not measured" rather than hanging on "Listening…".
      unsubscribeAudio.current =
        session?.subscribeAudio((samples, arrivalMs) => {
          if (!collecting.current) return;
          if (audioStartMs.current === null) audioStartMs.current = arrivalMs;
          // Interleaved stereo in; one channel is enough to measure pitch and level.
          for (let i = 0; i < samples.length; i += 2) captured.current.push(samples[i]! / 32768);
          if (captured.current.length >= AUDIO_SAMPLE_RATE * CAPTURE_SECONDS) finish();
        }) ?? null;

      unsubscribeFrames.current =
        session?.subscribeFrames((frame, height, arrivalMs) => {
          if (!collecting.current) return;
          const colour = sampleBackgroundColour(frame, height);
          if (colour === lastColour.current) {
            pendingColour.current = null;
            return;
          }
          // Commit a change only once a second frame agrees, but keep the FIRST frame's timestamp:
          // one glitched frame must not invent a colour change, and must not delay a real one.
          if (pendingColour.current?.colour === colour) {
            colourChanges.current.push(pendingColour.current);
            lastColour.current = colour;
            pendingColour.current = null;
            return;
          }
          pendingColour.current = { colour, atMs: arrivalMs };
        }) ?? null;

      window.setTimeout(
        () => {
          if (collecting.current) finish();
        },
        (CAPTURE_SECONDS + 2) * 1000,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setRunning(false);
      addLog("warn", "Tone & colour ladder: could not start", { service: "streams", error: message });
    }
  }, [finish, session]);

  const reset = useCallback(() => {
    stopListening();
    captured.current = [];
    colourChanges.current = [];
    setResult(null);
    setError(null);
  }, [stopListening]);

  return { running, result, error, run, reset };
};

export { CAPTURE_SECONDS as TONE_LADDER_CAPTURE_SECONDS, TONE_LADDER_LOOP_SECONDS, TONE_LADDER_SLOT_SECONDS };
