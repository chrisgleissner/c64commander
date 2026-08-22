/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Live View — follow-focus object tracking.
 *
 * Tracking-by-detection for the video mirror. The user picks a point; {@link SubjectTracker}
 * segments the object under it out of the local background, and every later tick it re-detects
 * blobs inside a motion-gated region and associates the best one with the target. Detection
 * never uses the target's own colour — a blob is whatever is NOT locally dominant — so a sprite
 * that flashes or is recoloured is still detected. Colour only scores the association.
 *
 * Frames are packed 4bpp VIC frames (two pixels per byte: low nibble = left pixel, high nibble
 * = right). Everything here is integer/float math over typed arrays: no DOM, no React, no
 * imports. Working buffers are allocated once and reused, so a steady-state tick allocates
 * only the handful of small candidate objects it scores.
 */

export type LockState = "idle" | "locked" | "coasting" | "searching" | "lost";

/** Where the tracked object is, in normalized frame coords `[0,1]`; velocity is per second. */
export interface TrackedSubject {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

export interface SubjectTrackResult {
  state: LockState;
  subject: TrackedSubject | null;
  /** `[0,1]`. Below ~0.4 the tracker is coasting or guessing and the camera should not commit. */
  confidence: number;
  /** How long the caller should wait before the next {@link SubjectTracker.update}. */
  nextIntervalMs: number;
}

/** A detected blob, in pixels, with a 16-bin palette histogram of counts. */
export interface CandidateBlob {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  hist: ArrayLike<number>;
}

/** The tracked object as it was last accepted; `hist` is normalized to sum 1. */
export interface SubjectModelView {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  vx: number;
  vy: number;
  hist: ArrayLike<number>;
}

export interface ScoreWeights {
  position: number;
  colour: number;
  area: number;
  shape: number;
  velocity: number;
}

export interface ScoreContext {
  predictedX: number;
  predictedY: number;
  gatePx: number;
  dtSec: number;
  width: number;
  height: number;
  weights?: ScoreWeights;
}

export interface CandidateScore {
  position: number;
  colour: number;
  area: number;
  shape: number;
  velocity: number;
  /** Colour, area and shape only — what a look-alike has to satisfy on its own merits. */
  appearance: number;
  total: number;
  distancePx: number;
}

export interface SubjectTrackerOptions {
  /** Half-extent of the window searched around the picked point, px. */
  acquireWindowPx?: number;
  /** How far from the picked point a foreground pixel may be and still count as the pick, px. */
  acquireSnapPx?: number;
  /** A picked blob covering more than this share of the window is background, not an object. */
  acquireMaxAreaFraction?: number;
  /** Sampling budget per tick; the sampling step rises until the region fits. */
  maxCells?: number;
  /** The tracked region is at least this multiple of the target's bounding box. */
  roiBboxFactor?: number;
  /** ...and at least this many pixels across. */
  roiMinPx?: number;
  /** A colour covering this share of the sampled region is treated as background. */
  backgroundShare?: number;
  /** At most this many colours are treated as background. */
  backgroundColours?: number;
  /** Association gate radius, px, before speed and coasting widen it. */
  gateBasePx?: number;
  /** Multiplier on the distance the target is predicted to travel this tick. */
  gateSpeedFactor?: number;
  /** How fast the gate opens while coasting, px per second of coasting. */
  gateCoastPxPerSec?: number;
  gateMaxPx?: number;
  /** Weighted score a candidate must reach to be accepted. */
  acceptScore?: number;
  /** ...and in `searching`, where position carries almost no information. */
  reacquireScore?: number;
  /** Appearance-only bar, so position alone can never accept a candidate. */
  minAppearance?: number;
  /** A blob this much larger than the model has merged with something else. */
  mergeAreaRatio?: number;
  /** Appearance-model adaptation per accepted tick. */
  adaptRate?: number;
  /** Time without an accepted measurement before the search widens to the whole frame. */
  coastMs?: number;
  /**
   * ...or this much, when nothing at all turned up inside the gate. A subject hidden behind
   * scenery leaves a neighbourhood that still holds candidates; one that respawned or walked
   * through a screen exit leaves an empty one, and that should not wait out the full coast.
   */
  emptyGateMs?: number;
  /** ...and after that, before the target is declared lost. */
  searchMs?: number;
  /** Velocity magnitude cap, px per second. */
  maxSpeedPx?: number;
  /**
   * A whole-frame palette histogram agreeing with the last tick's by less than this is a scene
   * cut — a new room, a level load, a death screen — and not motion. A scroll keeps the same
   * colours in roughly the same proportions, which is what separates the two.
   */
  sceneCutIntersection?: number;
  /** Sampling step for that histogram. Coarse on purpose: it is a colour census, not a picture. */
  sceneCutStep?: number;
  lockedIntervalMs?: number;
  activeIntervalMs?: number;
  idleIntervalMs?: number;
  /**
   * Run at `activeIntervalMs` even while locked once the subject would travel this many of its
   * own widths between ticks. A sampling rate has to scale with the motion it samples: a sprite
   * crossing a screen in a second leaves a slow tick chasing a position it has already left.
   */
  fastTickWidths?: number;
  /** Association weights; normalized internally, so only their ratios matter. */
  weights?: ScoreWeights;
  /** How many appearances of the subject may be remembered at once. */
  maxStates?: number;
  /** Appearance agreement below which a blob is a DIFFERENT look, not a drifted one. */
  stateNoveltyBelow?: number;
  /** Consecutive ticks a new look must survive before it is remembered as a state. */
  stateConfirmTicks?: number;
  /** ...and how many a merged blob must survive before it is believed to be growth. */
  growthConfirmTicks?: number;
}

/**
 * Association weights, normalized to sum 1. The split is the design: colour is worth well under
 * half, so a sprite that changes colour entirely still scores on the other cues and stays above
 * `acceptScore`, while position and velocity together are what stop a look-alike that is in the
 * wrong place or moving the wrong way. The values are the ones `scripts/tune-follow-focus.ts`
 * settled on against the synthetic games, chosen on a held-out seed set.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  position: 0.34,
  colour: 0.22,
  area: 0.18,
  shape: 0.1,
  velocity: 0.16,
};

/**
 * Fitted, not guessed. `scripts/tune-follow-focus.ts` searched these against the synthetic games
 * in `tests/helpers/gameScenarios.ts`, choosing on a held-out seed set; see
 * `docs/plans/follow-focus/DESIGN.md` §6 for the objective and the numbers. Editing one by hand
 * without re-running that script is how the fit quietly stops being one.
 */
const DEFAULTS: Required<SubjectTrackerOptions> = {
  acquireWindowPx: 48,
  acquireSnapPx: 12,
  acquireMaxAreaFraction: 0.35,
  maxCells: 12000,
  roiBboxFactor: 4.5,
  roiMinPx: 64,
  backgroundShare: 0.06,
  backgroundColours: 3,
  gateBasePx: 72,
  gateSpeedFactor: 1.6,
  gateCoastPxPerSec: 120,
  gateMaxPx: 200,
  acceptScore: 0.46,
  reacquireScore: 0.74,
  minAppearance: 0.35,
  mergeAreaRatio: 1.45,
  adaptRate: 0.1,
  coastMs: 300,
  emptyGateMs: 80,
  searchMs: 2500,
  maxSpeedPx: 2400,
  sceneCutIntersection: 0.6,
  sceneCutStep: 6,
  lockedIntervalMs: 40,
  activeIntervalMs: 20,
  idleIntervalMs: 200,
  fastTickWidths: 1,
  weights: DEFAULT_SCORE_WEIGHTS,
  maxStates: 4,
  stateNoveltyBelow: 0.55,
  stateConfirmTicks: 3,
  growthConfirmTicks: 4,
};

const HIST_BINS = 16;
const MAX_COMPONENTS = 256;

/** Appearance mix — colour is one of three cues, so a recolour cannot fail the bar alone. */
const A_COLOUR = 0.4;
const A_AREA = 0.4;
const A_SHAPE = 0.2;

/** Velocity agreement is judged against the target's own speed plus this floor, px/s. */
const VELOCITY_TOLERANCE_PX_PER_SEC = 120;

/** Alpha-beta (g-h) gains. Beta is alpha^2/(2-alpha), the critically damped choice. */
const ALPHA = 0.5;
const BETA = 0.1667;
const COAST_DAMPING = 0.9;
const ACQUIRE_CONFIDENCE = 0.9;

/**
 * Confidence moves on wall-clock time constants, not per tick: the tracker runs at 12.5 Hz
 * while locked and 25 Hz while it is trying to recover, and a per-tick rate would mean the
 * same half-second of trouble reported two different confidences depending on the state.
 */
const CONFIDENCE_RISE_MS = 120;
const CONFIDENCE_DECAY_MS = 250;
/** While the blob is a merge of the subject and something else, confidence says so. */
const AMBIGUOUS_CONFIDENCE = 0.35;

/**
 * How sure the MOTION evidence has to be before a blob that looks wrong is believed to be the
 * subject in a new state, and how far ahead of the runner-up it has to be for the frame to count
 * as unambiguous.
 */
const NEW_STATE_MIN_POSITION = 0.6;
const NEW_STATE_MIN_VELOCITY = 0.35;
const NEW_STATE_MIN_MARGIN = 0.12;

/** Blobs outside this multiple of the model's area are not worth scoring. */
const CANDIDATE_AREA_MIN_RATIO = 0.2;
const CANDIDATE_AREA_MAX_RATIO = 6;
const CANDIDATE_AREA_FLOOR_PX = 8;

const clamp = (value: number, lo: number, hi: number): number => (value < lo ? lo : value > hi ? hi : value);
/** Agreement of two normalized 16-bin histograms, in `[0,1]`. */
const histogramIntersection = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < HIST_BINS; i += 1) sum += a[i] < b[i] ? a[i] : b[i];
  return sum;
};
const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
const ratio = (a: number, b: number): number => (a <= 0 || b <= 0 ? 0 : a < b ? a / b : b / a);

/** The shorter way round a wrapping axis — a sprite that wraps has not moved a screen width. */
export const wrapDelta = (a: number, b: number, span: number): number => {
  let d = a - b;
  const half = span / 2;
  if (d > half) d -= span;
  else if (d < -half) d += span;
  return d;
};

const wrapCoord = (value: number, span: number): number => {
  const m = value % span;
  return m < 0 ? m + span : m;
};

const chooseStep = (w: number, h: number, maxCells: number): number => {
  let step = 1;
  while (step < 16 && Math.ceil(w / step) * Math.ceil(h / step) > maxCells) step += 1;
  return step;
};

/**
 * How well `candidate` explains `model` this tick: position against the motion prediction,
 * colour by histogram intersection, area and aspect by ratio, and velocity by how far the
 * implied step departs from the filtered one.
 */
export const scoreCandidate = (
  candidate: CandidateBlob,
  model: SubjectModelView,
  context: ScoreContext,
): CandidateScore => {
  const dx = wrapDelta(candidate.x, context.predictedX, context.width);
  const dy = wrapDelta(candidate.y, context.predictedY, context.height);
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  const gate = context.gatePx > 0 ? context.gatePx : 1;
  const position = clamp01(1 - distancePx / gate);

  let candidateTotal = 0;
  for (let i = 0; i < HIST_BINS; i += 1) candidateTotal += candidate.hist[i];
  let colour = 0;
  if (candidateTotal > 0) {
    for (let i = 0; i < HIST_BINS; i += 1) {
      const share = candidate.hist[i] / candidateTotal;
      const modelShare = model.hist[i];
      colour += share < modelShare ? share : modelShare;
    }
  }

  const area = ratio(candidate.area, model.area);
  const shape = ratio(candidate.h > 0 ? candidate.w / candidate.h : 0, model.h > 0 ? model.w / model.h : 0);

  const dtSec = context.dtSec > 0 ? context.dtSec : 0.02;
  const impliedVx = wrapDelta(candidate.x, model.x, context.width) / dtSec;
  const impliedVy = wrapDelta(candidate.y, model.y, context.height) / dtSec;
  const ex = impliedVx - model.vx;
  const ey = impliedVy - model.vy;
  const reference = Math.sqrt(model.vx * model.vx + model.vy * model.vy) + VELOCITY_TOLERANCE_PX_PER_SEC;
  const velocity = clamp01(1 - Math.sqrt(ex * ex + ey * ey) / (2 * reference));

  const w = context.weights ?? DEFAULT_SCORE_WEIGHTS;
  const sum = w.position + w.colour + w.area + w.shape + w.velocity;
  const total =
    (w.position * position + w.colour * colour + w.area * area + w.shape * shape + w.velocity * velocity) /
    (sum > 0 ? sum : 1);

  return {
    position,
    colour,
    area,
    shape,
    velocity,
    appearance: A_COLOUR * colour + A_AREA * area + A_SHAPE * shape,
    total,
    distancePx,
  };
};

/**
 * One remembered look of the subject. Slot 0 is the one the user picked and is never evicted,
 * which is what bounds drift (Matthews, Ishikawa & Baker, PAMI 2004): however far the later
 * slots wander, the original is always still there to match against.
 */
interface AppearanceState {
  hist: Float64Array;
  w: number;
  h: number;
  area: number;
  lastMatchedMs: number;
}

interface SubjectModel extends SubjectModelView {
  hist: Float64Array;
  confidence: number;
  /** Every look the subject is known to take: small and big, plain and powered-up. */
  bank: AppearanceState[];
  /** A look that keeps turning up where the subject should be, but is in no slot yet. */
  pending: { hist: Float64Array; w: number; h: number; area: number; ticks: number; merged: boolean } | null;
  /**
   * Which slot matched last. It is tried FIRST and the rest are skipped when it clears the bar,
   * so remembering several looks costs one extra histogram intersection on the ticks where the
   * look actually changed and nothing at all on the thousands where it did not.
   */
  activeSlot: number;
  ageMs: number;
}

export class SubjectTracker {
  private readonly o: Required<SubjectTrackerOptions>;
  private model: SubjectModel | null = null;
  private lockState: LockState = "idle";
  private missMs = 0;
  private emptyMs = 0;
  private searchLatched = false;

  private frameWidth = 0;
  private frameHeight = 0;
  private xs = new Int32Array(0);
  private ys = new Int32Array(0);
  private readonly colours: Uint8Array;
  private readonly fg: Uint8Array;
  private readonly dil: Uint8Array;
  private readonly labels: Int32Array;
  private readonly stack: Int32Array;
  private readonly bgCounts = new Int32Array(HIST_BINS);
  private readonly globalHist = new Float64Array(HIST_BINS);
  private readonly globalCounts = new Int32Array(HIST_BINS);
  private hasGlobalHist = false;
  private readonly scratchHist = new Float64Array(HIST_BINS);
  /** Reused view onto one bank slot, so scoring four looks allocates nothing. */
  private readonly slotView: SubjectModelView = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    area: 0,
    vx: 0,
    vy: 0,
    hist: new Float64Array(HIST_BINS),
  };
  private readonly comp = {
    count: 0,
    area: new Int32Array(MAX_COMPONENTS),
    sumI: new Float64Array(MAX_COMPONENTS),
    sumJ: new Float64Array(MAX_COMPONENTS),
    minI: new Int32Array(MAX_COMPONENTS),
    maxI: new Int32Array(MAX_COMPONENTS),
    minJ: new Int32Array(MAX_COMPONENTS),
    maxJ: new Int32Array(MAX_COMPONENTS),
    hist: new Int32Array(MAX_COMPONENTS * HIST_BINS),
  };

  constructor(options?: SubjectTrackerOptions) {
    this.o = { ...DEFAULTS, ...(options ?? {}) };
    const cells = Math.max(64, Math.floor(this.o.maxCells));
    this.o.maxCells = cells;
    this.colours = new Uint8Array(cells);
    this.fg = new Uint8Array(cells);
    this.dil = new Uint8Array(cells);
    this.labels = new Int32Array(cells);
    this.stack = new Int32Array(cells);
  }

  get state(): LockState {
    return this.lockState;
  }

  /** Forget the target. The next {@link update} reports `idle` until something is acquired. */
  release(): void {
    this.model = null;
    this.lockState = "idle";
    this.missMs = 0;
    this.emptyMs = 0;
    this.searchLatched = false;
    this.hasGlobalHist = false;
  }

  /**
   * Lock onto whatever object covers the normalized point `(nx, ny)`.
   *
   * Fails — returning `idle` and holding no target — when the point is on the local background
   * or the blob under it is most of the window, which is the honest answer to a long-press on
   * empty sky rather than a lock on nothing.
   */
  acquire(frame: Uint8Array, width: number, height: number, nx: number, ny: number): SubjectTrackResult {
    this.ensure(width, height);
    const px = clamp(nx * width, 0, width - 1);
    const py = clamp(ny * height, 0, height - 1);
    const roiW = Math.min(width, this.o.acquireWindowPx * 2 + 1);
    const roiH = Math.min(height, this.o.acquireWindowPx * 2 + 1);
    const step = chooseStep(roiW, roiH, this.o.maxCells);
    const cols = Math.ceil(roiW / step);
    const rows = Math.ceil(roiH / step);
    const x0 = Math.round(px) - Math.floor(((cols - 1) * step) / 2);
    const y0 = Math.round(py) - Math.floor(((rows - 1) * step) / 2);

    this.sceneChanged(frame, width, height); // primes the census; the first call never cuts
    this.sample(frame, width, height, x0, y0, cols, rows, step);
    const cells = cols * rows;
    const pickI = clamp(Math.round((px - x0) / step), 0, cols - 1);
    const pickJ = clamp(Math.round((py - y0) / step), 0, rows - 1);
    // A big sprite can be common enough in its own window to classify itself as background, so
    // the picked colour is held out of the background estimate — unless it is the single most
    // common colour in the window, which means the finger landed on the background itself and
    // the pick should snap to a neighbouring object instead.
    const picked = this.colours[pickJ * cols + pickI];
    this.segment(cells, cols, rows, picked === this.dominantColour(cells) ? -1 : picked);

    const seed = this.nearestLabelled(pickI, pickJ, cols, rows, Math.ceil(this.o.acquireSnapPx / step));
    if (seed < 0) {
      this.release();
      return this.result();
    }
    const s = this.labels[seed] - 1;
    if (this.comp.area[s] > cells * this.o.acquireMaxAreaFraction) {
      this.release();
      return this.result();
    }

    const hist = new Float64Array(HIST_BINS);
    const total = this.comp.area[s];
    for (let i = 0; i < HIST_BINS; i += 1) hist[i] = this.comp.hist[s * HIST_BINS + i] / total;
    const w = (this.comp.maxI[s] - this.comp.minI[s] + 1) * step;
    const h = (this.comp.maxJ[s] - this.comp.minJ[s] + 1) * step;
    const area = total * step * step;
    this.model = {
      x: wrapCoord(x0 + (this.comp.sumI[s] / total) * step, width),
      y: wrapCoord(y0 + (this.comp.sumJ[s] / total) * step, height),
      w,
      h,
      area,
      vx: 0,
      vy: 0,
      hist,
      confidence: ACQUIRE_CONFIDENCE,
      bank: [{ hist: hist.slice(), w, h, area, lastMatchedMs: 0 }],
      pending: null,
      activeSlot: 0,
      ageMs: 0,
    };
    this.lockState = "locked";
    this.missMs = 0;
    this.emptyMs = 0;
    this.searchLatched = false;
    return this.result();
  }

  /** Advance the target by `dtMs` of elapsed time and re-associate it with the new frame. */
  update(frame: Uint8Array, width: number, height: number, dtMs: number): SubjectTrackResult {
    const model = this.model;
    if (!model) return this.result();
    this.ensure(width, height);

    const dtSec = clamp(dtMs, 1, 500) / 1000;
    // A scene cut invalidates the prediction, the velocity and the local background estimate all
    // at once. Carrying on from them is how a tracker ends a level change confidently locked on
    // to a piece of the new room's scenery.
    const sceneCut = this.sceneChanged(frame, width, height);
    if (sceneCut) {
      model.vx = 0;
      model.vy = 0;
      this.searchLatched = true;
    }
    const searching = this.lockState === "searching" || sceneCut;
    const speed = Math.sqrt(model.vx * model.vx + model.vy * model.vy);
    const predictedX = wrapCoord(model.x + model.vx * dtSec, width);
    const predictedY = wrapCoord(model.y + model.vy * dtSec, height);

    const gate = searching
      ? Math.sqrt(width * width + height * height) / 2
      : clamp(
          this.o.gateBasePx + speed * dtSec * this.o.gateSpeedFactor + (this.missMs / 1000) * this.o.gateCoastPxPerSec,
          this.o.gateBasePx,
          this.o.gateMaxPx,
        );

    const spanW = Math.max(this.o.roiBboxFactor * model.w, 2 * gate + model.w);
    const spanH = Math.max(this.o.roiBboxFactor * model.h, 2 * gate + model.h);
    const roiW = searching ? width : clamp(spanW, this.o.roiMinPx, width);
    const roiH = searching ? height : clamp(spanH, this.o.roiMinPx, height);
    const step = chooseStep(roiW, roiH, this.o.maxCells);
    const cols = Math.ceil(roiW / step);
    const rows = Math.ceil(roiH / step);
    const x0 = searching ? 0 : Math.round(predictedX) - Math.floor(((cols - 1) * step) / 2);
    const y0 = searching ? 0 : Math.round(predictedY) - Math.floor(((rows - 1) * step) / 2);

    this.sample(frame, width, height, x0, y0, cols, rows, step);
    this.segment(cols * rows, cols, rows, -1);

    const context: ScoreContext = {
      predictedX,
      predictedY,
      gatePx: gate,
      dtSec,
      width,
      height,
      weights: this.o.weights,
    };
    // Searching means the subject has been missing long enough that the prediction is a guess
    // and the implied velocity of anything that turns up is meaningless. So a re-acquisition is
    // decided on looks alone, with position only breaking ties, and has to clear a higher bar.
    const rank = (score: CandidateScore): number =>
      searching ? score.appearance + 0.05 * score.position : score.total;
    const areaFloor = Math.max(CANDIDATE_AREA_FLOOR_PX, model.area * CANDIDATE_AREA_MIN_RATIO);
    const areaCeiling = model.area * CANDIDATE_AREA_MAX_RATIO;
    let bestIndex = -1;
    let bestSlot = 0;
    let best: CandidateScore | null = null;
    let bestBlob: CandidateBlob | null = null;
    let runnerUp = 0;
    let previousBest = 0;
    let inGate = 0;

    for (let s = 0; s < this.comp.count; s += 1) {
      const cellCount = this.comp.area[s];
      const area = cellCount * step * step;
      if (area < areaFloor || area > areaCeiling) continue;
      const cx = wrapCoord(x0 + (this.comp.sumI[s] / cellCount) * step, width);
      const cy = wrapCoord(y0 + (this.comp.sumJ[s] / cellCount) * step, height);
      const dx = wrapDelta(cx, predictedX, width);
      const dy = wrapDelta(cy, predictedY, height);
      if (dx * dx + dy * dy > gate * gate) continue;
      inGate += 1;
      const blob: CandidateBlob = {
        x: cx,
        y: cy,
        w: (this.comp.maxI[s] - this.comp.minI[s] + 1) * step,
        h: (this.comp.maxJ[s] - this.comp.minJ[s] + 1) * step,
        area,
        hist: this.comp.hist.subarray(s * HIST_BINS, s * HIST_BINS + HIST_BINS),
      };
      const matched = this.scoreAgainstBank(blob, model, context, searching);
      if (!best || rank(matched.score) > rank(best)) {
        best = matched.score;
        bestSlot = matched.slot;
        bestIndex = s;
        bestBlob = blob;
        runnerUp = previousBest;
      }
      previousBest = matched.score.total > previousBest ? matched.score.total : previousBest;
    }

    const accepted =
      best !== null &&
      (searching
        ? best.appearance >= this.o.reacquireScore
        : best.total >= this.o.acceptScore && best.appearance >= this.o.minAppearance);
    // A blob much larger than the model is the target merged with whatever crossed it. Its
    // centroid sits between the two, so following it is how a tracker changes identity without
    // noticing. Coast through the merge instead, and say so with the confidence.
    const merged = accepted && bestBlob !== null && bestBlob.area > this.o.mergeAreaRatio * model.area;

    if (accepted && !merged && best && bestBlob) {
      // A whole-frame search that finds the subject exactly where the prediction said is a brief
      // blink, not a teleport, so the motion model is still good and is kept. Only a measurement
      // that is genuinely somewhere else re-initiates the track: feeding a jump the subject never
      // travelled to the velocity gain would fling the next prediction off the far side.
      if (searching && best.distancePx > this.o.gateBasePx) {
        model.x = bestBlob.x;
        model.y = bestBlob.y;
        model.vx = 0;
        model.vy = 0;
      } else {
        const rx = wrapDelta(bestBlob.x, predictedX, width);
        const ry = wrapDelta(bestBlob.y, predictedY, height);
        model.x = wrapCoord(predictedX + ALPHA * rx, width);
        model.y = wrapCoord(predictedY + ALPHA * ry, height);
        model.vx = clamp(model.vx + (BETA / dtSec) * rx, -this.o.maxSpeedPx, this.o.maxSpeedPx);
        model.vy = clamp(model.vy + (BETA / dtSec) * ry, -this.o.maxSpeedPx, this.o.maxSpeedPx);
      }
      model.activeSlot = bestSlot;
      model.ageMs += dtMs;
      this.adopt(model, bestBlob, bestIndex, bestSlot);
      model.confidence += (best.total - model.confidence) * (1 - Math.exp(-dtMs / CONFIDENCE_RISE_MS));
      this.missMs = 0;
      this.emptyMs = 0;
      this.searchLatched = false;
      this.lockState = "locked";
      return this.result();
    }

    // Not accepted on looks — but if it is unambiguously WHERE the subject should be and moving
    // the way it was, the subject has changed how it looks rather than gone away. That is a state
    // to learn, not a miss; `considerNewState` decides, and only after it has held for several
    // ticks. On promotion this tick becomes a normal accepted one.
    if (best && bestBlob && this.considerNewState(model, best, bestBlob, bestIndex, merged, runnerUp, dtMs)) {
      model.x = bestBlob.x;
      model.y = bestBlob.y;
      model.vx = 0;
      model.vy = 0;
      model.confidence = Math.max(model.confidence, this.o.acceptScore);
      this.missMs = 0;
      this.emptyMs = 0;
      this.searchLatched = false;
      this.lockState = "locked";
      return this.result();
    }

    model.x = predictedX;
    model.y = predictedY;
    model.vx *= COAST_DAMPING;
    model.vy *= COAST_DAMPING;
    const decayed = model.confidence * Math.exp(-dtMs / CONFIDENCE_DECAY_MS);
    model.confidence = merged ? Math.min(decayed, AMBIGUOUS_CONFIDENCE) : decayed;
    this.missMs += dtMs;
    this.emptyMs = inGate === 0 ? this.emptyMs + dtMs : 0;
    // Latched, because the whole-frame search re-fills the gate with candidates and the
    // fast-path condition would otherwise clear itself on the very next tick.
    if (this.missMs > this.o.coastMs || this.emptyMs > this.o.emptyGateMs) this.searchLatched = true;
    if (this.missMs > this.o.coastMs + this.o.searchMs) {
      this.model = null;
      this.lockState = "lost";
    } else this.lockState = this.searchLatched ? "searching" : "coasting";
    return this.result();
  }

  /** Blend the accepted blob into the matched slot — slowly, so one flashed frame cannot rewrite it. */
  private adopt(model: SubjectModel, blob: CandidateBlob, index: number, slotIndex: number): void {
    const rate = this.o.adaptRate;
    const slot = model.bank[slotIndex] ?? model.bank[0];
    slot.w += (blob.w - slot.w) * rate;
    slot.h += (blob.h - slot.h) * rate;
    slot.area += (blob.area - slot.area) * rate;
    slot.lastMatchedMs = model.ageMs;
    model.pending = null;
    // The top-level w/h/area are what the region and the merge test are sized from, so they
    // follow the slot that is actually matching rather than an average of every look.
    model.w = slot.w;
    model.h = slot.h;
    model.area = slot.area;
    let total = 0;
    for (let i = 0; i < HIST_BINS; i += 1) total += this.comp.hist[index * HIST_BINS + i];
    if (total <= 0) return;
    for (let i = 0; i < HIST_BINS; i += 1) {
      const share = this.comp.hist[index * HIST_BINS + i] / total;
      slot.hist[i] += (share - slot.hist[i]) * rate;
      model.hist[i] = slot.hist[i];
    }
  }

  /**
   * Should this blob be remembered as another look of the subject?
   *
   * Learning a new look is how the tracker follows a sprite that grows, powers up or changes
   * state — and it is also how a tracker permanently poisons itself with whatever happened to
   * be overlapping the subject at the wrong moment. So four things must hold at once, and the
   * last of them is what separates the two cases:
   *
   * 1. The blob is where the motion model says the subject is, and moving as it was. Identity
   *    has to come from motion precisely because appearance is what disagrees.
   * 2. Nothing else in the region came close to explaining it. An ambiguous frame teaches nothing.
   * 3. It really is a different look, not the current one drifting.
   * 4. It has held for several consecutive ticks — and LONGER when the blob is big enough to be
   *    a merge. Two sprites overlapping separate again within a few frames, so they never earn a
   *    slot; a sprite that actually doubled in size stays doubled, and does.
   */
  private considerNewState(
    model: SubjectModel,
    score: CandidateScore,
    blob: CandidateBlob,
    index: number,
    merged: boolean,
    runnerUp: number,
    dtMs: number,
  ): boolean {
    model.ageMs += dtMs;
    if (score.position < NEW_STATE_MIN_POSITION || score.velocity < NEW_STATE_MIN_VELOCITY) {
      model.pending = null;
      return false;
    }
    if (runnerUp > score.total - NEW_STATE_MIN_MARGIN) {
      model.pending = null;
      return false;
    }

    let total = 0;
    for (let i = 0; i < HIST_BINS; i += 1) total += this.comp.hist[index * HIST_BINS + i];
    if (total <= 0) {
      model.pending = null;
      return false;
    }
    // Into a reused scratch, not a fresh array: this runs on every tick the subject is missing,
    // and a Float64Array per tick is GC pressure on the device this has to be cheap on.
    const hist = this.scratchHist;
    for (let i = 0; i < HIST_BINS; i += 1) hist[i] = this.comp.hist[index * HIST_BINS + i] / total;

    const pending = model.pending;
    const consistent =
      pending !== null && histogramIntersection(hist, pending.hist) >= this.o.stateNoveltyBelow && ratio(blob.area, pending.area) > 0.6; // prettier-ignore
    if (!consistent) {
      // The one allocation, and only when a genuinely new look turns up.
      model.pending = { hist: hist.slice(), w: blob.w, h: blob.h, area: blob.area, ticks: 1, merged };
      return false;
    }

    pending.hist.set(hist);
    pending.w = blob.w;
    pending.h = blob.h;
    pending.area = blob.area;
    pending.merged = pending.merged || merged;
    pending.ticks += 1;
    const needed = pending.merged ? this.o.growthConfirmTicks : this.o.stateConfirmTicks;
    if (pending.ticks < needed) return false;

    this.admitState(model, pending.hist, pending.w, pending.h, pending.area);
    model.pending = null;
    return true;
  }

  /** Add a look to the bank, evicting the least recently matched one — never slot 0. */
  private admitState(model: SubjectModel, hist: Float64Array, w: number, h: number, area: number): void {
    const state: AppearanceState = { hist, w, h, area, lastMatchedMs: model.ageMs };
    if (model.bank.length < this.o.maxStates) {
      model.bank.push(state);
      model.activeSlot = model.bank.length - 1;
    } else {
      let oldest = 1;
      for (let i = 2; i < model.bank.length; i += 1) {
        if (model.bank[i].lastMatchedMs < model.bank[oldest].lastMatchedMs) oldest = i;
      }
      model.bank[oldest] = state;
      model.activeSlot = oldest;
    }
    model.w = w;
    model.h = h;
    model.area = area;
    model.hist.set(hist);
  }

  /**
   * Score one blob against the remembered looks, trying the one that matched last FIRST and
   * stopping there when it already clears the bar. Slot 0 — what the user picked — is always
   * tried, so a subject that comes back to its original look is recognised however far the
   * later slots have drifted.
   */
  private scoreAgainstBank(
    blob: CandidateBlob,
    model: SubjectModel,
    context: ScoreContext,
    searching: boolean,
  ): { score: CandidateScore; slot: number } {
    const view = this.slotView;
    view.x = model.x;
    view.y = model.y;
    view.vx = model.vx;
    view.vy = model.vy;
    const bar = searching ? this.o.reacquireScore : this.o.minAppearance;

    const scoreSlot = (index: number): CandidateScore => {
      const slot = model.bank[index];
      view.w = slot.w;
      view.h = slot.h;
      view.area = slot.area;
      view.hist = slot.hist;
      return scoreCandidate(blob, view, context);
    };

    let bestSlot = model.activeSlot < model.bank.length ? model.activeSlot : 0;
    let best = scoreSlot(bestSlot);
    if (best.appearance >= bar) return { score: best, slot: bestSlot };
    for (let index = 0; index < model.bank.length; index += 1) {
      if (index === bestSlot) continue;
      const score = scoreSlot(index);
      if (score.total > best.total) {
        best = score;
        bestSlot = index;
      }
    }
    return { score: best, slot: bestSlot };
  }

  private result(): SubjectTrackResult {
    const model = this.model;
    const state = this.lockState;
    const fast =
      model !== null &&
      Math.sqrt(model.vx * model.vx + model.vy * model.vy) * (this.o.lockedIntervalMs / 1000) >
        this.o.fastTickWidths * Math.max(model.w, model.h);
    const nextIntervalMs =
      state === "locked"
        ? fast
          ? this.o.activeIntervalMs
          : this.o.lockedIntervalMs
        : state === "coasting" || state === "searching"
          ? this.o.activeIntervalMs
          : this.o.idleIntervalMs;
    if (!model) return { state, subject: null, confidence: 0, nextIntervalMs };
    return {
      state,
      confidence: clamp01(model.confidence),
      nextIntervalMs,
      subject: {
        x: model.x / this.frameWidth,
        y: model.y / this.frameHeight,
        w: model.w / this.frameWidth,
        h: model.h / this.frameHeight,
        vx: model.vx / this.frameWidth,
        vy: model.vy / this.frameHeight,
      },
    };
  }

  private ensure(width: number, height: number): void {
    if (this.frameWidth === width && this.frameHeight === height) return;
    this.frameWidth = width;
    this.frameHeight = height;
    if (this.xs.length < width) this.xs = new Int32Array(width);
    if (this.ys.length < height) this.ys = new Int32Array(height);
  }

  /**
   * Read the sampled grid out of the packed frame. Column and row indices are wrapped first, so
   * a region straddling an edge samples the far side — which is where a sprite that wrapped is.
   */
  private sample(
    frame: Uint8Array,
    width: number,
    height: number,
    x0: number,
    y0: number,
    cols: number,
    rows: number,
    step: number,
  ): void {
    const { xs, ys, colours } = this;
    for (let i = 0; i < cols; i += 1) xs[i] = wrapCoord(x0 + i * step, width);
    for (let j = 0; j < rows; j += 1) ys[j] = wrapCoord(y0 + j * step, height);
    let o = 0;
    for (let j = 0; j < rows; j += 1) {
      const rowBase = ys[j] * width;
      for (let i = 0; i < cols; i += 1) {
        const p = rowBase + xs[i];
        const packed = frame[p >> 1];
        colours[o] = (p & 1) === 1 ? (packed >> 4) & 0x0f : packed & 0x0f;
        o += 1;
      }
    }
  }

  /** Background estimate → foreground mask → 1-cell dilation → connected components. */
  private segment(cells: number, cols: number, rows: number, exclude: number): void {
    const background = this.background(cells, exclude);
    const { fg, colours } = this;
    for (let c = 0; c < cells; c += 1) fg[c] = ((background >> colours[c]) & 1) === 1 ? 0 : 1;
    this.dilate(cols, rows);
    this.label(cols, rows);
  }

  /**
   * The colours that dominate the sampled region, as a 16-bit mask. The most common one is
   * always background even below the share threshold: with nothing marked background every
   * pixel is foreground and the whole region labels as one useless blob.
   */
  private background(cells: number, exclude: number): number {
    const counts = this.bgCounts;
    counts.fill(0);
    for (let c = 0; c < cells; c += 1) counts[this.colours[c]] += 1;
    const threshold = cells * this.o.backgroundShare;
    let mask = 0;
    for (let n = 0; n < this.o.backgroundColours; n += 1) {
      let best = -1;
      let bestCount = 0;
      for (let k = 0; k < HIST_BINS; k += 1) {
        if (((mask >> k) & 1) === 1 || k === exclude) continue;
        if (counts[k] > bestCount) {
          bestCount = counts[k];
          best = k;
        }
      }
      if (best < 0 || (n > 0 && bestCount < threshold)) break;
      mask |= 1 << best;
    }
    return mask;
  }

  /**
   * Grow the mask by one cell for CONNECTIVITY only. A C64 sprite is usually several colours
   * with background showing between them; without this the arms and the body label separately
   * and the tracker follows an arm.
   */
  private dilate(cols: number, rows: number): void {
    const { fg, dil } = this;
    const cells = cols * rows;
    dil.set(fg.subarray(0, cells));
    for (let j = 0; j < rows; j += 1) {
      const base = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const c = base + i;
        if (fg[c] === 0) continue;
        if (i > 0) dil[c - 1] = 1;
        if (i < cols - 1) dil[c + 1] = 1;
        if (j > 0) dil[c - cols] = 1;
        if (j < rows - 1) dil[c + cols] = 1;
      }
    }
  }

  /** 8-connected flood fill over the dilated mask; statistics accumulate on true foreground only. */
  private label(cols: number, rows: number): void {
    const { fg, dil, colours, labels, stack, comp } = this;
    const cells = cols * rows;
    labels.fill(0, 0, cells);
    comp.count = 0;
    for (let seed = 0; seed < cells; seed += 1) {
      if (fg[seed] === 0 || labels[seed] !== 0) continue;
      if (comp.count >= MAX_COMPONENTS) break;
      const id = comp.count + 1;
      const s = comp.count;
      comp.count = id;
      comp.area[s] = 0;
      comp.sumI[s] = 0;
      comp.sumJ[s] = 0;
      comp.minI[s] = cols;
      comp.maxI[s] = -1;
      comp.minJ[s] = rows;
      comp.maxJ[s] = -1;
      comp.hist.fill(0, s * HIST_BINS, s * HIST_BINS + HIST_BINS);
      let sp = 0;
      labels[seed] = id;
      stack[sp] = seed;
      sp += 1;
      while (sp > 0) {
        sp -= 1;
        const p = stack[sp];
        const i = p % cols;
        const j = (p - i) / cols;
        if (fg[p] === 1) {
          comp.area[s] += 1;
          comp.sumI[s] += i;
          comp.sumJ[s] += j;
          if (i < comp.minI[s]) comp.minI[s] = i;
          if (i > comp.maxI[s]) comp.maxI[s] = i;
          if (j < comp.minJ[s]) comp.minJ[s] = j;
          if (j > comp.maxJ[s]) comp.maxJ[s] = j;
          comp.hist[s * HIST_BINS + colours[p]] += 1;
        }
        const j0 = j > 0 ? j - 1 : 0;
        const j1 = j < rows - 1 ? j + 1 : rows - 1;
        const i0 = i > 0 ? i - 1 : 0;
        const i1 = i < cols - 1 ? i + 1 : cols - 1;
        for (let nj = j0; nj <= j1; nj += 1) {
          const rowBase = nj * cols;
          for (let ni = i0; ni <= i1; ni += 1) {
            const q = rowBase + ni;
            if (labels[q] === 0 && dil[q] === 1) {
              labels[q] = id;
              stack[sp] = q;
              sp += 1;
            }
          }
        }
      }
    }
  }

  /**
   * Has the picture been REPLACED since the last tick, rather than moved?
   *
   * A coarse census of the whole frame's palette, compared with the last one by histogram
   * intersection. Scrolling, animation and sprites moving all leave the census nearly unchanged;
   * a new room or a level load does not. Also primes itself, so the first call never reports a cut.
   */
  private sceneChanged(frame: Uint8Array, width: number, height: number): boolean {
    const step = Math.max(1, Math.floor(this.o.sceneCutStep));
    const counts = this.globalCounts;
    counts.fill(0);
    let total = 0;
    for (let y = 0; y < height; y += step) {
      const rowBase = y * width;
      for (let x = 0; x < width; x += step) {
        const p = rowBase + x;
        const packed = frame[p >> 1];
        counts[(p & 1) === 1 ? (packed >> 4) & 0x0f : packed & 0x0f] += 1;
        total += 1;
      }
    }
    if (total === 0) return false;
    let intersection = 0;
    for (let i = 0; i < HIST_BINS; i += 1) {
      const share = counts[i] / total;
      intersection += share < this.globalHist[i] ? share : this.globalHist[i];
      this.globalHist[i] = share;
    }
    if (!this.hasGlobalHist) {
      this.hasGlobalHist = true;
      return false;
    }
    return intersection < this.o.sceneCutIntersection;
  }

  /** The single most common colour in the sampled region. */
  private dominantColour(cells: number): number {
    const counts = this.bgCounts;
    counts.fill(0);
    for (let c = 0; c < cells; c += 1) counts[this.colours[c]] += 1;
    let best = 0;
    for (let k = 1; k < HIST_BINS; k += 1) if (counts[k] > counts[best]) best = k;
    return best;
  }

  /** The nearest labelled foreground cell to `(i, j)`, searched outward in square rings. */
  private nearestLabelled(i: number, j: number, cols: number, rows: number, maxRadius: number): number {
    for (let r = 0; r <= maxRadius; r += 1) {
      for (let dj = -r; dj <= r; dj += 1) {
        const nj = j + dj;
        if (nj < 0 || nj >= rows) continue;
        const edge = Math.abs(dj) === r;
        for (let di = -r; di <= r; di += 1) {
          if (!edge && Math.abs(di) !== r) continue;
          const ni = i + di;
          if (ni < 0 || ni >= cols) continue;
          const c = nj * cols + ni;
          if (this.fg[c] === 1 && this.labels[c] !== 0) return c;
        }
      }
    }
    return -1;
  }
}
