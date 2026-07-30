/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
export type ResolveDurationFn = (virtualPath: string, songIndex: number) => number | null | Promise<number | null>;
export type BuildStationItemFn = (input: {
  virtualPath: string;
  songIndex: number;
  reason: StationReason;
  trackOrdinal: number;
  md5_48: string;
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
}

export interface StationRefillResult {
  items: PlaylistItem[];
  /** Set when the station could produce no more items. */
  reason?: "no-neighbours" | "exhausted";
}

const DEFAULT_LOOKAHEAD = 10;
const REFILL_BATCH = 24;

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
    const items: PlaylistItem[] = [];
    // Bound the work: even if every candidate is unresolved, we cannot loop forever.
    let guard = 0;
    const maxGuard = Math.max(count, 1) * 50 + REFILL_BATCH * 4;

    while (items.length < count && guard < maxGuard) {
      guard += 1;
      if (this.buffer.length === 0) {
        if (this.exhausted) break;
        const result = await this.options.computeCandidates(this.excludedOrdinals, this.recentOrdinals, REFILL_BATCH);
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
      const virtualPath = this.options.resolvePath(candidate.md5_48);
      if (!virtualPath) continue; // removed tune — skip, no gap (§2.5)
      if (this.minSeconds > 0 && this.options.resolveDuration) {
        // A tune of a second or two is a sound effect, not music, and a station that serves them
        // between pieces reads as broken. Skipped exactly like a removed tune: the ordinal is already
        // consumed, so the next refill asks the engine for somewhere else rather than offering it
        // again. An unknown length is admitted — never drop a tune because the songlengths are thin.
        const seconds = await this.options.resolveDuration(virtualPath, candidate.songIndex);
        if (seconds !== null && seconds < this.minSeconds) {
          this.tooShortSkipped += 1;
          continue;
        }
      }
      items.push(
        this.options.buildItem({
          virtualPath,
          songIndex: candidate.songIndex,
          reason: candidate.reason,
          trackOrdinal: candidate.trackOrdinal,
          md5_48: candidate.md5_48,
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

  /** How many candidates were dropped for being shorter than {@link StationQueueProviderOptions.minSeconds}. */
  get shortTracksSkipped(): number {
    return this.tooShortSkipped;
  }

  /** Reset the exhausted flag (e.g. after a steer changes the candidate space). */
  clearExhausted(): void {
    this.exhausted = null;
    this.buffer = [];
  }
}
