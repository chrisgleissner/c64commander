/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Typed message contract for the SID Radio Web Worker (spec §6.5). A single
 * contract test (§8.3) pins every shape so the main thread and worker cannot
 * drift. The engine is pure, so a `compute` request carries the full station
 * state (seed/style/shuffleSeed/likes/notForMe/exclude) each time — the worker
 * only holds the parsed bundle.
 */

import type { StationCandidate, StationSeed } from "@/lib/sidRadio/stationEngine";

/** main → worker: load and parse the bundle (fetch the bundled asset if none given). */
export interface SidRadioLoadMessage {
  type: "load";
  /** Optional pre-fetched bundle (ownership transferred). Fetched by the worker if absent. */
  bundle?: ArrayBuffer;
}

/** A stateless station computation request (the queue provider owns the exclude set). */
export interface StationRequest {
  seed: StationSeed;
  styleFilter?: number | null;
  shuffleSeed: number;
  likes: string[];
  notForMe: string[];
  exclude: number[];
  count: number;
}

/** main → worker: compute the next candidate batch for a station request. */
export interface SidRadioComputeMessage {
  type: "compute";
  /** Correlates the response to this request. */
  id: number;
  request: StationRequest;
}

export type SidRadioMainToWorker = SidRadioLoadMessage | SidRadioComputeMessage;

/** Ready-stats surfaced after a successful load (mirrors §9.4 counters). */
export interface SidRadioReadyStats {
  bundleLoadMs: number;
  reverseIndexMs: number;
  memoryEstimateBytes: number;
  fileCount: number;
  trackCount: number;
  edgeCount: number;
  styleCount: number;
  /** MUST be false — the engine runs off the main thread (§9.4 / G3). */
  engineThreadIsMain: boolean;
}

export interface SidRadioReadyMessage {
  type: "ready";
  stats: SidRadioReadyStats;
}

export interface SidRadioErrorMessage {
  type: "error";
  code: string;
  message: string;
  /** Correlation id when the error answers a `compute` request. */
  id?: number;
}

/** worker → main: resolved candidate batch for a `compute` request. */
export interface SidRadioCandidatesMessage {
  type: "candidates";
  id: number;
  candidates: StationCandidate[];
}

/** worker → main: the station could produce nothing for this request. */
export interface SidRadioEmptyMessage {
  type: "empty";
  id: number;
  reason: "no-neighbours" | "exhausted";
}

export type SidRadioWorkerToMain =
  SidRadioReadyMessage | SidRadioErrorMessage | SidRadioCandidatesMessage | SidRadioEmptyMessage;
