/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "@/pages/playFiles/types";
import type { StationCandidate, StationReason, StationResult } from "@/lib/sidRadio/stationEngine";

/**
 * Turns the engine's ordered candidate stream into resolved playable
 * `PlaylistItem`s and keeps the playlist refilled ahead of the cursor (spec §6.1
 * `stationQueueProvider`). It is the stateful main-thread layer over the pure
 * (worker) engine:
 *
 *  - asks for candidates (via the worker) excluding everything already consumed,
 *  - resolves each `md5_48 → virtualPath` through `md5PathIndex`,
 *  - **skips a candidate whose path no longer resolves** (removed by an HVSC
 *    update, §2.5) — no error, no gap,
 *  - never double-appends (every consumed ordinal is excluded once).
 */

export type ComputeCandidatesFn = (excludeOrdinals: number[], count: number) => Promise<StationResult>;
export type ResolvePathFn = (md5_48: string) => string | null;
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
  /** Target items to keep queued ahead of the cursor (default 10). */
  lookahead?: number;
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
  private buffer: StationCandidate[] = [];
  private exhausted: "no-neighbours" | "exhausted" | null = null;
  readonly lookahead: number;

  constructor(private readonly options: StationQueueProviderOptions) {
    this.lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD;
    for (const ordinal of options.initialExclude ?? []) this.excluded.add(ordinal);
  }

  /** Track ordinals consumed so far (played, queued, or skipped) — the resume exclude set. */
  get excludedOrdinals(): number[] {
    return [...this.excluded];
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
        const result = await this.options.computeCandidates(this.excludedOrdinals, REFILL_BATCH);
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
      this.excluded.add(candidate.trackOrdinal); // consumed exactly once (emit or skip)
      const virtualPath = this.options.resolvePath(candidate.md5_48);
      if (!virtualPath) continue; // removed tune — skip, no gap (§2.5)
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

  /** Reset the exhausted flag (e.g. after a steer changes the candidate space). */
  clearExhausted(): void {
    this.exhausted = null;
    this.buffer = [];
  }
}
