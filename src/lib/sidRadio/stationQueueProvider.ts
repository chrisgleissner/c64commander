/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { DEFAULT_STATION_BALANCE } from "@/lib/sidRadio/stationEngine";
import type { StationCandidate, StationReason, StationResult } from "@/lib/sidRadio/stationEngine";

/**
 * Turns the engine's ordered candidate stream into resolved playable
 * `PlaylistItem`s and keeps the playlist refilled ahead of the cursor (spec §6.1
 * `stationQueueProvider`). It is the stateful main-thread layer over the pure
 * (worker) engine:
 *
 *  - asks for candidates (via the worker) excluding everything already consumed
 *    and telling it what was consumed most recently, so the query drifts,
 *  - resolves each `md5_48 → virtualPath` through `md5PathIndex`,
 *  - **skips a candidate whose path no longer resolves** (removed by an HVSC
 *    update, §2.5) — no error, no gap,
 *  - retires every subsong of a file it plays one subsong of, because a listener
 *    hears those as the same tune,
 *  - never double-appends (every consumed ordinal is excluded once).
 */

export type ComputeCandidatesFn = (
  excludeOrdinals: number[],
  recentOrdinals: number[],
  count: number,
) => Promise<StationResult>;
export type ResolvePathFn = (md5_48: string) => string | null;
/**
 * Length of a track in seconds, or null when unknown.
 *
 * Keyed by the resolved virtual path rather than the md5, because that is what the songlengths index
 * is keyed by and what the provider has in hand at the moment it decides.
 */
export type ResolveDurationFn = (virtualPath: string, songNr: number) => number | null | Promise<number | null>;
export type BuildStationItemFn = (input: {
  virtualPath: string;
  songNr: number;
  reason: StationReason;
  trackOrdinal: number;
  md5_48: string;
  /**
   * The length this tune was admitted on, or null when nothing could resolve it.
   *
   * Passed on rather than discarded: the provider has just looked it up to decide whether the tune
   * is long enough, and an item built without it falls back to the three-minute default. That is
   * what the whole queue displayed, and the default also drives the progress bar and the end of the
   * track, so a thirty-second tune both read and behaved as three minutes.
   */
  durationSeconds: number | null;
}) => PlaylistItem;

export interface StationQueueProviderOptions {
  computeCandidates: ComputeCandidatesFn;
  resolvePath: ResolvePathFn;
  buildItem: BuildStationItemFn;
  initialExclude?: Iterable<number>;
  /**
   * Ordinals the station played most recently before this provider was built, most recent first.
   *
   * The resume path needs it: the drifting query is aimed by what was just heard, so a station
   * restored with only its exclude set would restart from its original seed and emit a different
   * continuation. `initialExclude` cannot stand in for it — that set also holds the retired subsong
   * siblings, which were never played, and a `Set`'s iteration order is not a specification.
   */
  initialRecent?: Iterable<number>;
  /** Target items to keep queued ahead of the cursor (default 10). */
  lookahead?: number;
  /** How many recently consumed ordinals the engine is told about (default: the shipped balance). */
  recentWindow?: number;
  /**
   * Shortest track the station will emit, in seconds. 0 (the default here) admits everything.
   *
   * The engine applies the same rule while it walks, which is what stops a filtered-out neighbourhood
   * looking like an exhausted station. This second pass exists because the walk runs in a worker
   * against a bundle that carries no durations, so the authoritative check has to happen where the
   * songlengths actually live.
   */
  minSeconds?: number;
  /** Songlength lookup for {@link minSeconds}. Absent → no length filtering here. */
  resolveDuration?: ResolveDurationFn;
  /**
   * Awaited once before the first candidate is resolved.
   *
   * `resolvePath` is a synchronous lookup into an index that is built as a side effect of loading
   * the HVSC songlengths, and a station resumed on app start refills immediately — so the two
   * raced. Measured on the Pixel 4 against a fully ingested HVSC: **2,454 candidates dropped as
   * unresolved and none emitted**, leaving a live station unable to produce a single track.
   *
   * The cost is not just the failed refill. A candidate is consumed before it is resolved, so every
   * one of those tracks was added to the exclude set and can never be offered again — the station
   * permanently lost 2,454 tunes to a race. Waiting once, here, is what makes the first refill ask
   * a question the index can answer.
   */
  ensureResolvable?: () => Promise<unknown>;
}

export interface StationRefillResult {
  items: PlaylistItem[];
  /** Set when the station could produce no more items. */
  reason?: "no-neighbours" | "exhausted";
}

const DEFAULT_LOOKAHEAD = 10;

/**
 * Candidate batch sizing.
 *
 * A refill asks the engine for a batch, then throws away every candidate whose `md5_48` does not
 * resolve against the installed HVSC or whose length is below {@link
 * StationQueueProviderOptions.minSeconds}. When the batch runs out before `count` items have been
 * built, it asks again — so the number of engine computes per refill is `count / yield`, not 1.
 *
 * At a fixed batch of 24 that ratio is what made a deep station expensive. Measured on the Pixel 4
 * at ~60,000 exclusions, one refill cost 3.9 s against a 150 ms budget, which is roughly 25
 * computes of ~14 ms each rather than one slow compute. The per-compute cost was never the defect;
 * the multiplier was.
 *
 * So the batch is sized from the yield this station has actually observed, rather than fixed. A
 * station whose candidates nearly all resolve keeps asking for ~24; one discarding 90% of them asks
 * for ten times as many in a single compute. `OVERSHOOT` covers the variance in a small sample, and
 * the ceiling stops a pathological yield asking for a batch whose sort costs more than the extra
 * computes would have.
 */
const REFILL_BATCH_MIN = 24;
const REFILL_BATCH_MAX = 512;
const REFILL_BATCH_OVERSHOOT = 1.5;
/** Floor on the observed yield, so a run of discards cannot ask for an unbounded batch. */
const MIN_ASSUMED_YIELD = 0.02;

export class StationQueueProvider {
  private readonly excluded = new Set<number>();
  /** The drifting query's aim: the last {@link recentWindow} consumed ordinals, most recent first. */
  private recent: number[] = [];
  private buffer: StationCandidate[] = [];
  private exhausted: "no-neighbours" | "exhausted" | null = null;
  readonly lookahead: number;
  readonly recentWindow: number;
  private readonly minSeconds: number;
  /** Tracks dropped for being too short — reported so a thin station is explicable, not mysterious. */
  private tooShortSkipped = 0;
  /** Tracks dropped because `md5_48` did not resolve against the installed HVSC. */
  private unresolvedSkipped = 0;
  /**
   * Tracks admitted with no known length.
   *
   * Counted separately from an admitted tune of known-good length, because "we checked and it is
   * long enough" and "we could not find out" are different facts and only the second one can put a
   * three-second tune in front of a listener. Without this the minimum-length rule looks like it is
   * working whenever the songlengths are thin.
   */
  private unknownDurationAdmitted = 0;
  /** Candidates taken out of the buffer, whether or not they became items — the yield denominator. */
  private candidatesConsumed = 0;
  /** Items actually queued — the yield numerator. */
  private itemsEmitted = 0;
  /** Engine computes issued, so a refill's cost can be attributed to count rather than guessed. */
  private computeCalls = 0;
  /** Whether {@link StationQueueProviderOptions.ensureResolvable} has been awaited. */
  private resolvableAwaited = false;

  constructor(private readonly options: StationQueueProviderOptions) {
    this.lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD;
    this.recentWindow = options.recentWindow ?? DEFAULT_STATION_BALANCE.recentWindow;
    this.minSeconds = Math.max(0, options.minSeconds ?? 0);
    for (const ordinal of options.initialExclude ?? []) this.excluded.add(ordinal);
    this.recent = [...(options.initialRecent ?? [])].slice(0, this.recentWindow);
  }

  /** Track ordinals consumed or retired so far — the resume exclude set. */
  get excludedOrdinals(): number[] {
    return [...this.excluded];
  }

  /**
   * The most recently consumed ordinals, most recent first — the engine's `recent` seeds.
   *
   * Explicitly ordered rather than read off the tail of {@link excludedOrdinals}: that set also holds
   * retired siblings the station never played, and relying on `Set` iteration order would make G11
   * determinism an accident of the runtime rather than a property of the inputs.
   */
  get recentOrdinals(): number[] {
    return [...this.recent];
  }

  /** Resolve the next `count` (default: lookahead) playable items, advancing the exclude set. */
  async refill(count = this.lookahead): Promise<StationRefillResult> {
    // Once per provider, and before anything is consumed.
    if (this.options.ensureResolvable && !this.resolvableAwaited) {
      this.resolvableAwaited = true;
      try {
        await this.options.ensureResolvable();
      } catch (error) {
        // A path index that will not load is reported by the empty refill that follows. Failing to
        // wait is not a reason to burn the candidates this wait exists to protect, so the refill
        // proceeds — but silently proceeding would make the next empty station inexplicable.
        addLog("warn", "SID Radio: path index was not ready before the first refill", {
          service: "sid-radio",
          error: (error as Error)?.message ?? String(error),
        });
      }
    }
    const items: PlaylistItem[] = [];
    // Bound the work: even if every candidate is unresolved, we cannot loop forever.
    let guard = 0;
    const maxGuard = Math.max(count, 1) * 50 + REFILL_BATCH_MAX * 4;

    while (items.length < count && guard < maxGuard) {
      guard += 1;
      if (this.buffer.length === 0) {
        if (this.exhausted) break;
        this.computeCalls += 1;
        const result = await this.options.computeCandidates(
          this.excludedOrdinals,
          this.recentOrdinals,
          this.nextBatchSize(count - items.length),
        );
        if (result.candidates.length === 0) {
          this.exhausted = result.empty ?? "exhausted";
          break;
        }
        // Guard against a producer that ignores the exclude set (would loop).
        this.buffer = result.candidates.filter((candidate) => !this.excluded.has(candidate.trackOrdinal));
        if (this.buffer.length === 0) {
          this.exhausted = "exhausted";
          break;
        }
      }

      const candidate = this.buffer.shift()!;
      // A sibling retired mid-batch is already excluded: the engine offered several subsongs of one
      // file in the same batch, and consuming the first retired the rest.
      if (this.excluded.has(candidate.trackOrdinal)) continue;
      this.consume(candidate);
      this.candidatesConsumed += 1;
      const virtualPath = this.options.resolvePath(candidate.md5_48);
      if (!virtualPath) {
        this.unresolvedSkipped += 1;
        continue; // removed tune — skip, no gap (§2.5)
      }
      let durationSeconds: number | null = null;
      // Resolved whenever a resolver exists, not only when the rule is on: the length is what the
      // queue displays and what the track's end is taken from, and asking for it twice would mean
      // the tune admitted and the tune shown could disagree.
      if (this.options.resolveDuration) {
        // A tune of a second or two is a sound effect, not music, and a station that serves them
        // between pieces reads as broken. Skipped exactly like a removed tune: the ordinal is already
        // consumed, so the next refill asks the engine for somewhere else rather than offering it
        // again. An unknown length is admitted — never drop a tune because the songlengths are thin.
        const seconds = await this.options.resolveDuration(virtualPath, candidate.songNr);
        durationSeconds = seconds === null || seconds === undefined || !Number.isFinite(seconds) ? null : seconds;
        if (this.minSeconds <= 0) {
          // Filtering is off, so nothing is rejected and nothing is counted as an unknown-length
          // admission — there is no rule for a missing length to slip past.
        } else if (durationSeconds === null) {
          // Admitted, and counted as such. A malformed length is treated exactly like a missing one
          // rather than compared numerically, because `NaN < minSeconds` is false and would admit it
          // silently through the branch below.
          this.unknownDurationAdmitted += 1;
        } else if (durationSeconds < this.minSeconds) {
          this.tooShortSkipped += 1;
          continue;
        }
      }
      this.itemsEmitted += 1;
      items.push(
        this.options.buildItem({
          virtualPath,
          songNr: candidate.songNr,
          reason: candidate.reason,
          trackOrdinal: candidate.trackOrdinal,
          md5_48: candidate.md5_48,
          durationSeconds,
        }),
      );
    }

    return { items, reason: items.length === 0 && this.exhausted ? this.exhausted : undefined };
  }

  /**
   * Take a candidate out of circulation, along with every other subsong of its file.
   *
   * The exclude set holds track ordinals, so without this a station happily played subsong 1, 2 and 3
   * of the same `.sid` back to back — three ordinals, one tune as far as a listener is concerned. The
   * corpus averages 1.44 subsongs per file over 61,157 files, so retiring the siblings outright costs
   * the station almost nothing and needs no rule the UI would have to explain.
   */
  private consume(candidate: StationCandidate): void {
    this.excluded.add(candidate.trackOrdinal);
    this.recent = [candidate.trackOrdinal, ...this.recent].slice(0, this.recentWindow);
    for (const sibling of candidate.fileTrackOrdinals) this.excluded.add(sibling);
  }

  /**
   * How large the next engine batch should be to yield `stillNeeded` items in one compute.
   *
   * Sized from the yield this station has observed so far, so the cost of a deep station is the
   * cost of the candidates it actually needs rather than the number of times its buffer ran dry.
   * Before any candidate has been consumed the yield is unknown and the minimum is used, which is
   * the behaviour a shallow station had all along.
   */
  private nextBatchSize(stillNeeded: number): number {
    const yieldRatio =
      this.candidatesConsumed === 0 ? 1 : Math.max(this.itemsEmitted / this.candidatesConsumed, MIN_ASSUMED_YIELD);
    const wanted = Math.ceil((Math.max(stillNeeded, 1) / yieldRatio) * REFILL_BATCH_OVERSHOOT);
    return Math.min(Math.max(wanted, REFILL_BATCH_MIN), REFILL_BATCH_MAX);
  }

  /** How many candidates were dropped for being shorter than {@link StationQueueProviderOptions.minSeconds}. */
  get shortTracksSkipped(): number {
    return this.tooShortSkipped;
  }

  /** How many candidates were dropped because their `md5_48` did not resolve to an installed path. */
  get unresolvedTracksSkipped(): number {
    return this.unresolvedSkipped;
  }

  /**
   * How many queued items were admitted without a known length.
   *
   * Non-zero means the minimum-length rule is not fully in force: those tunes were let through
   * because the songlengths could not answer, not because they were long enough.
   */
  get unknownDurationTracksAdmitted(): number {
    return this.unknownDurationAdmitted;
  }

  /** Engine computes issued over this provider's life — the refill-cost multiplier. */
  get engineComputeCalls(): number {
    return this.computeCalls;
  }

  /** Fraction of consumed candidates that became queued items (1 when nothing consumed yet). */
  get candidateYield(): number {
    return this.candidatesConsumed === 0 ? 1 : this.itemsEmitted / this.candidatesConsumed;
  }

  /** Reset the exhausted flag (e.g. after a steer changes the candidate space). */
  clearExhausted(): void {
    this.exhausted = null;
    this.buffer = [];
  }
}
