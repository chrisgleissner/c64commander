/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Typed message contract for the SID Radio Web Worker (spec §6.5).
 *
 * M0 establishes only the harness subset (`load` → `ready`/`error`). The seed /
 * more / steer / candidates / empty messages are added with `stationEngine`
 * (M2), where a single contract test (§8.3) pins every shape so the main thread
 * and worker cannot drift.
 */

/** main → worker: load and parse the bundle (fetch the bundled asset if none given). */
export interface SidRadioLoadMessage {
  type: "load";
  /** Optional pre-fetched bundle (ownership transferred). Fetched by the worker if absent. */
  bundle?: ArrayBuffer;
}

export type SidRadioMainToWorker = SidRadioLoadMessage;

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
}

export type SidRadioWorkerToMain = SidRadioReadyMessage | SidRadioErrorMessage;
