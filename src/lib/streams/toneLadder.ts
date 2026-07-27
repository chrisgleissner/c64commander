/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The tone & colour ladder: a known signal for measuring what actually arrives.
 *
 * The A/V-sync and tap-latency checks answer "when". This one answers "what, and did the picture
 * agree with it". A 307-byte PSID plays a C-major octave up and back — 16 notes and two silences,
 * ~0.499 s per slot, 9.0 s per loop — and steps the screen background through all 16 VIC colours,
 * one per note, written in the same instruction sequence as the note itself. Because tone and
 * colour leave the machine together, any gap a receiver measures between them belongs to the
 * transport.
 *
 * It exists because "the stream sounds rough" turned out to be a second Ultimate streaming into the
 * same multicast group — arriving at double rate with two interleaved sequence spaces. Nothing in
 * the receive path looked wrong (no loss, no underruns), yet every note came out at roughly double
 * length and the wrong pitch, and the silences were not silent. This check makes all three visible
 * in a single run.
 *
 * MEASUREMENT CONVENTIONS
 *
 *   pitch    cents (1200 per octave); ~5 c is the just-noticeable difference for a trained ear.
 *   A/V      milliseconds, audio minus video, so POSITIVE means the sound leads the picture.
 *            Graded against ITU-R BT.1359-1, the broadcast standard for relative sound/vision
 *            timing: undetectable within +45/-125 ms, unacceptable beyond +90/-185 ms.
 *   level    dBFS. The silence floor uses ITU-R BS.1770 / EBU R128's absolute gate of -70 as the
 *            pass line, measured on an AC-coupled signal.
 *   stats    median and interquartile range, never a bare mean: one dropout must not move the
 *            headline, and the spread is what says whether the path is steady.
 */

/** The scale the ladder walks: a C-major octave, C3 up to C4. */
export const TONE_LADDER_SCALE_NAMES = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"] as const;
const SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12];

/** Equal temperament from A3 = 220 Hz; C3 is nine semitones below. */
const SCALE_HZ = SCALE_SEMITONES.map((semitone) => 220 * 2 ** ((semitone - 9) / 12));

/** VIC palette names, in register order — the background steps through all 16, one per note. */
export const C64_COLOUR_NAMES = [
  "black",
  "white",
  "red",
  "cyan",
  "purple",
  "green",
  "blue",
  "yellow",
  "orange",
  "brown",
  "pink",
  "dark grey",
  "grey",
  "light green",
  "light blue",
  "light grey",
] as const;

/**
 * PAL is not 50 Hz. The VIC's vertical refresh is 985248/19656 = 50.1245 Hz, so a 25-frame slot
 * lasts 498.76 ms. Assuming a round 50 would put a constant -1 ms on every note — small, but a
 * timing instrument must not invent a bias it then reports as a finding.
 */
export const PAL_REFRESH_HZ = 985248 / 19656;
const FRAMES_PER_SLOT = 25;
export const TONE_LADDER_SLOT_SECONDS = FRAMES_PER_SLOT / PAL_REFRESH_HZ;

export interface ToneLadderSlot {
  readonly index: number;
  readonly name: string;
  /** 0 for a silent slot. */
  readonly hz: number;
  /** Palette index the background holds during this slot, or null where the colour is held over. */
  readonly colour: number | null;
  readonly colourName: string | null;
}

/**
 * The 18 slots, in order: a silence, a full octave up, a silence, a full octave back down.
 *
 * The silences are landmarks — the only unambiguous position in a looping tune — and measurements
 * in their own right. They also separate the two C4 notes at the turn, so a repeated pitch still
 * has a clean boundary.
 */
export const TONE_LADDER_SLOTS: readonly ToneLadderSlot[] = (() => {
  const top = TONE_LADDER_SCALE_NAMES.length - 1;
  const order = [
    -1,
    ...TONE_LADDER_SCALE_NAMES.map((_, i) => i),
    -1,
    ...Array.from({ length: top + 1 }, (_, i) => top - i),
  ];
  let colour = 0;
  return order.map((degree, index) => {
    if (degree < 0) return { index, name: "silence", hz: 0, colour: null, colourName: null };
    const slot = {
      index,
      name: TONE_LADDER_SCALE_NAMES[degree]!,
      hz: SCALE_HZ[degree]!,
      colour: colour % C64_COLOUR_NAMES.length,
      colourName: C64_COLOUR_NAMES[colour % C64_COLOUR_NAMES.length]!,
    };
    colour += 1;
    return slot;
  });
})();

export const TONE_LADDER_LOOP_SLOTS = TONE_LADDER_SLOTS.length;
export const TONE_LADDER_LOOP_SECONDS = TONE_LADDER_LOOP_SLOTS * TONE_LADDER_SLOT_SECONDS;
/** Only the sounding slots, in play order. */
export const TONE_LADDER_NOTES = TONE_LADDER_SLOTS.filter((slot) => slot.hz > 0);

/** Which slot a given background colour identifies. Each of the 16 colours appears exactly once. */
export const slotForColour = (colour: number): ToneLadderSlot | null =>
  TONE_LADDER_SLOTS.find((slot) => slot.colour === colour) ?? null;

/**
 * The fixture itself, embedded rather than fetched.
 *
 * 307 bytes: cheaper to inline than to add a network round trip and a failure mode to a diagnostic
 * that exists to diagnose the network. Generated by `tools/hil/make_tone_ladder_sid.py`; the same
 * bytes are committed at `tests/fixtures/tone-ladder.sid`.
 */
export const TONE_LADDER_SID_BASE64 =
  "UFNJRAACAHwAABAAECcAAQABAAAAAEM2NCBDb21tYW5kZXIgdG9uZSAmIGNvbG91ciBsYWRkQzY0IENvbW1hbmRlciBISUwAAAAAAAAAAAAAAAAAAAAyMDI2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQqQCF+6kBhfypD40Y1KkAjSDQqQCNIdCpAI0F1KnwjQbUqQCNBNRgxvzwE6X8yQWwSKq9sBCNGNSpEI0E1GCm++ASkAKiAL2eEMn/8BuNIdC9ehCNANS9jBCNAdSpD40Y1KkRjQTU0AqpEI0E1KkAjRjU6Ib7qRmF/GAAtMT3nQqibWcAZ22iCp33xLQACAkKCw0OEBEAERAODQsKCQj/AAECAwQFBgf/CAkKCwwNDg8AAAQICw==";

export const toneLadderSidBytes = (): Uint8Array => {
  const binary = atob(TONE_LADDER_SID_BASE64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

// ── measurement ───────────────────────────────────────────────────────────────

export interface ToneLadderNote {
  slot: number;
  expected: string;
  expectedHz: number;
  detectedHz: number;
  cents: number;
  /** Palette index the background held during this note, for rendering a swatch. */
  colour: number | null;
  colourName: string | null;
  /** Inter-onset interval, seconds. */
  seconds: number;
  expectedSeconds: number;
  lengthErrorMs: number;
  ok: boolean;
}

/** ITU-R BT.1359-1 verdict for a measured sound-to-vision offset. */
export type AvSyncVerdict = "undetectable" | "detectable" | "unacceptable" | "not measured";

export interface AvSyncGrade {
  samples: number;
  /** Audio minus video: positive means the sound arrives ahead of the picture. */
  medianOffsetMs: number;
  spreadMs: number;
  /** Slope across the run; a constant offset is pipeline depth, a growing one is a clock mismatch. */
  driftPpm: number | null;
  verdict: AvSyncVerdict;
}

export interface SilenceGrade {
  measured: number;
  floorDbfs: number | null;
  peakDbfs: number | null;
  passed: boolean;
}

export interface ToneLadderResult {
  notes: ToneLadderNote[];
  notesInTune: number;
  inTunePct: number;
  medianCentsError: number;
  centsSpread: number;
  medianLengthErrorMs: number;
  lengthSpreadMs: number;
  /** Notes materially shorter than expected — audio lost inside a note. */
  shortNotes: number;
  /** Notes materially longer — a boundary was lost, or playback is running slow. */
  longNotes: number;
  silence: SilenceGrade;
  av: AvSyncGrade;
}

/** A quarter tone. Wide enough for a phone speaker in a room, far too tight for a wrong note. */
export const TONE_LADDER_TOLERANCE_CENTS = 50;
/** ITU-R BS.1770 / EBU R128 absolute gate. */
export const SILENCE_GATE_DBFS = -70;
/** ITU-R BT.1359-1 detectability thresholds, in ms, audio relative to video. */
export const AV_DETECTABLE_MS = { lead: 45, lag: -125 } as const;
export const AV_UNACCEPTABLE_MS = { lead: 90, lag: -185 } as const;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * fraction;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return low === high ? sorted[low]! : sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
};

/** Interquartile range — the spread that a single outlier cannot inflate. */
export const interquartileRange = (values: number[]): number =>
  values.length < 2 ? 0 : percentile(values, 0.75) - percentile(values, 0.25);

export const centsBetween = (detectedHz: number, expectedHz: number): number =>
  detectedHz > 0 && expectedHz > 0 ? 1200 * Math.log2(detectedHz / expectedHz) : Number.POSITIVE_INFINITY;

/**
 * Strongest partial in the ladder's range, folded to the fundamental.
 *
 * A Goertzel scan over candidate semitones rather than an FFT: the search space is a couple of
 * dozen known pitches, so testing those directly is cheaper and more accurate than binning a
 * transform. The range runs an octave BELOW C3 deliberately — the two-sender fault halves the
 * apparent pitch, and a detector that cannot represent the failure cannot report it.
 */
export const detectFundamentalHz = (samples: Float32Array, sampleRate: number): number => {
  if (samples.length < 256) return 0;
  const lowest = SCALE_HZ[0]!;
  const powers: { hz: number; power: number }[] = [];
  for (let semitone = -13; semitone <= 25; semitone += 1) {
    const hz = lowest * 2 ** (semitone / 12);
    const omega = (2 * Math.PI * hz) / sampleRate;
    const coeff = 2 * Math.cos(omega);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const s0 = samples[i]! + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    powers.push({ hz, power: s1 * s1 + s2 * s2 - coeff * s1 * s2 });
  }

  let best = powers.reduce((a, b) => (b.power > a.power ? b : a), powers[0]!);
  // A triangle wave's odd harmonics can out-score the fundamental once a speaker has rolled off the
  // bottom. If half the winning frequency also carries real energy, that is the true fundamental.
  for (let fold = 0; fold < 2; fold += 1) {
    const half = powers.find((candidate) => Math.abs(centsBetween(candidate.hz, best.hz / 2)) < 25);
    if (!half || half.power < best.power * 0.25) break;
    best = half;
  }
  return best.hz;
};

export interface ToneLadderNoteInput {
  hz: number;
  /** Inter-onset interval in seconds. */
  seconds: number;
  /** When the onset was heard, if timestamps are available. */
  atMs?: number;
}

export interface ToneLadderExtras {
  silences?: { rmsDbfs: number; peakDbfs: number }[];
  colourChanges?: { colour: number; atMs: number }[];
}

/** How many slots pass between this note's onset and the next note's. */
const slotsUntilNextNote = (slotIndex: number): number => {
  let span = 1;
  while (TONE_LADDER_SLOTS[(slotIndex + span) % TONE_LADDER_LOOP_SLOTS]!.hz === 0) span += 1;
  return span;
};

/**
 * Which slot the first detected note occupies.
 *
 * Searched rather than assumed, because a looping tune is joined wherever the listener happened to
 * start. Cheap: sixteen candidate rotations scored against the pitches actually heard.
 */
const anchorSlot = (notes: ToneLadderNoteInput[]): number => {
  let best = TONE_LADDER_NOTES[0]!.index;
  let bestScore = -1;
  for (const candidate of TONE_LADDER_NOTES) {
    let score = 0;
    let slot = candidate.index;
    for (const note of notes) {
      while (TONE_LADDER_SLOTS[slot % TONE_LADDER_LOOP_SLOTS]!.hz === 0) slot += 1;
      const expected = TONE_LADDER_SLOTS[slot % TONE_LADDER_LOOP_SLOTS]!.hz;
      if (Math.abs(centsBetween(note.hz, expected)) <= TONE_LADDER_TOLERANCE_CENTS) score += 1;
      slot += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate.index;
    }
  }
  return best;
};

interface ColourPairing {
  colour: number;
  offsetMs: number;
  atMs: number;
  heardHz: number;
}

/**
 * Pair each colour change with the note onset nearest to it.
 *
 * The pairing carries the pitch as well as the time, because a colour identifies its slot uniquely:
 * the picture says which note ought to be sounding. A pair that lines up in time but lands on the
 * wrong pitch is a content fault, not a timing one, and the two must not be reported as one number.
 */
const pairColoursWithNotes = (inputs: ToneLadderNoteInput[], extras: ToneLadderExtras): ColourPairing[] => {
  const pairs: ColourPairing[] = [];
  for (const change of extras.colourChanges ?? []) {
    let nearest: ColourPairing | null = null;
    for (const note of inputs) {
      if (note.atMs === undefined) continue;
      const offsetMs = note.atMs - change.atMs;
      if (Math.abs(offsetMs) > TONE_LADDER_SLOT_SECONDS * 500) continue;
      if (!nearest || Math.abs(offsetMs) < Math.abs(nearest.offsetMs)) {
        nearest = { colour: change.colour, offsetMs, atMs: note.atMs, heardHz: note.hz };
      }
    }
    if (nearest) pairs.push(nearest);
  }
  return pairs;
};

const gradeAvSync = (pairs: ColourPairing[]): AvSyncGrade => {
  const offsets = pairs;

  if (offsets.length === 0) {
    return { samples: 0, medianOffsetMs: 0, spreadMs: 0, driftPpm: null, verdict: "not measured" };
  }

  const values = offsets.map((o) => o.offsetMs);
  const medianOffsetMs = median(values);
  // Drift is a slope, and a slope needs a baseline long enough to see one. Two points cannot tell a
  // clock mismatch from noise, so it is reported as unknown rather than as zero.
  let driftPpm: number | null = null;
  const spanMs = offsets[offsets.length - 1]!.atMs - offsets[0]!.atMs;
  if (offsets.length >= 4 && spanMs > TONE_LADDER_LOOP_SECONDS * 500) {
    const meanX = offsets.reduce((sum, o) => sum + o.atMs, 0) / offsets.length;
    const meanY = values.reduce((sum, v) => sum + v, 0) / values.length;
    let num = 0;
    let den = 0;
    for (const o of offsets) {
      num += (o.atMs - meanX) * (o.offsetMs - meanY);
      den += (o.atMs - meanX) ** 2;
    }
    if (den > 0) driftPpm = (num / den) * 1e6;
  }

  const verdict: AvSyncVerdict =
    medianOffsetMs > AV_UNACCEPTABLE_MS.lead || medianOffsetMs < AV_UNACCEPTABLE_MS.lag
      ? "unacceptable"
      : medianOffsetMs > AV_DETECTABLE_MS.lead || medianOffsetMs < AV_DETECTABLE_MS.lag
        ? "detectable"
        : "undetectable";

  return {
    samples: offsets.length,
    medianOffsetMs: Math.round(medianOffsetMs * 10) / 10,
    spreadMs: Math.round(interquartileRange(values) * 10) / 10,
    driftPpm: driftPpm === null ? null : Math.round(driftPpm),
    verdict,
  };
};

/**
 * Grade a captured ladder.
 *
 * `notes` are the sounding segments already split out of the stream, in arrival order, each with the
 * interval to the following onset. Everything else is optional: the grader reports on what it was
 * given and says "not measured" for the rest, rather than inventing a number.
 */
export const gradeToneLadder = (notes: ToneLadderNoteInput[], extras: ToneLadderExtras = {}): ToneLadderResult => {
  const silences = extras.silences ?? [];
  const floorDbfs = silences.length ? Math.max(...silences.map((s) => s.rmsDbfs)) : null;
  const peakDbfs = silences.length ? Math.max(...silences.map((s) => s.peakDbfs)) : null;
  const silence: SilenceGrade = {
    measured: silences.length,
    floorDbfs,
    peakDbfs,
    passed: floorDbfs !== null && floorDbfs <= SILENCE_GATE_DBFS,
  };

  if (notes.length === 0) {
    return {
      notes: [],
      notesInTune: 0,
      inTunePct: 0,
      medianCentsError: 0,
      centsSpread: 0,
      medianLengthErrorMs: 0,
      lengthSpreadMs: 0,
      shortNotes: 0,
      longNotes: 0,
      silence,
      av: { samples: 0, medianOffsetMs: 0, spreadMs: 0, driftPpm: null, verdict: "not measured" },
    };
  }

  let slot = anchorSlot(notes);
  const graded: ToneLadderNote[] = notes.map((note) => {
    while (TONE_LADDER_SLOTS[slot % TONE_LADDER_LOOP_SLOTS]!.hz === 0) slot += 1;
    const reference = TONE_LADDER_SLOTS[slot % TONE_LADDER_LOOP_SLOTS]!;
    const expectedSeconds = slotsUntilNextNote(slot % TONE_LADDER_LOOP_SLOTS) * TONE_LADDER_SLOT_SECONDS;
    const cents = centsBetween(note.hz, reference.hz);
    slot += 1;
    return {
      slot: reference.index,
      expected: reference.name,
      expectedHz: reference.hz,
      detectedHz: note.hz,
      cents: Number.isFinite(cents) ? Math.round(cents * 10) / 10 : cents,
      colour: reference.colour,
      colourName: reference.colourName,
      seconds: note.seconds,
      expectedSeconds,
      lengthErrorMs: Math.round((note.seconds - expectedSeconds) * 1000 * 10) / 10,
      ok: Math.abs(cents) <= TONE_LADDER_TOLERANCE_CENTS,
    };
  });

  const inTune = graded.filter((note) => note.ok);
  const absCents = graded.map((note) => Math.abs(note.cents)).filter((value) => Number.isFinite(value));
  const lengthErrors = graded.map((note) => note.lengthErrorMs);

  return {
    notes: graded,
    notesInTune: inTune.length,
    inTunePct: Math.round((100 * inTune.length) / graded.length),
    medianCentsError: Math.round(median(absCents) * 10) / 10,
    centsSpread: Math.round(interquartileRange(absCents) * 10) / 10,
    medianLengthErrorMs: Math.round(median(lengthErrors) * 10) / 10,
    lengthSpreadMs: Math.round(interquartileRange(lengthErrors) * 10) / 10,
    shortNotes: graded.filter((note) => note.seconds < note.expectedSeconds * 0.7).length,
    longNotes: graded.filter((note) => note.seconds > note.expectedSeconds * 1.4).length,
    silence,
    av: gradeAvSync(pairColoursWithNotes(notes, extras)),
  };
};
