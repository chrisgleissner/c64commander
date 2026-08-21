/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { StationResult } from "./stationEngine";
import type { SidRadioReadyStats, SidRadioWorkerToMain, StationRequest } from "./sidRadioWorkerProtocol";

/**
 * Main-thread client for the SID Radio worker. Owns the worker lifecycle and a
 * promise-based `load()`.
 *
 * Off-main-thread guard (§8.6): the engine runs **only** in a worker. There is
 * no synchronous main-thread fallback — if the environment has no `Worker`, the
 * client rejects loudly rather than parsing/BFS-ing on the UI thread (the class
 * of work that has starved Remote Input before,
 * [[hvsc-hydration-starved-remote-input]]).
 */

export type SidRadioWorkerFactory = () => Worker;

const defaultWorkerFactory: SidRadioWorkerFactory = () => {
  if (typeof Worker === "undefined") {
    throw new SidRadioWorkerUnavailableError();
  }
  // Vite compiles this into a module-worker chunk and rewrites the URL for both
  // the web build and the Capacitor WebView.
  return new Worker(new URL("./sidRadio.worker.ts", import.meta.url), { type: "module" });
};

export class SidRadioWorkerUnavailableError extends Error {
  constructor() {
    super("SID Radio requires Web Workers; refusing to run the engine on the main thread");
    this.name = "SidRadioWorkerUnavailableError";
  }
}

export interface SidRadioLoadOptions {
  /** Optional pre-fetched bundle to transfer (else the worker fetches it). */
  bundle?: ArrayBuffer;
  /** Reject if the worker does not answer in time. */
  timeoutMs?: number;
}

interface PendingCompute {
  resolve: (result: StationResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SidRadioWorkerClient {
  private worker: Worker | null = null;
  private loadPending: {
    resolve: (s: SidRadioReadyStats) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private loadInFlight: Promise<SidRadioReadyStats> | null = null;
  private readonly computePending = new Map<number, PendingCompute>();
  private nextId = 1;

  constructor(private readonly factory: SidRadioWorkerFactory = defaultWorkerFactory) {}

  /** True when the engine can run off-main-thread in this environment. */
  static isSupported(): boolean {
    return typeof Worker !== "undefined";
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = this.factory();
      this.worker.addEventListener("message", (event: MessageEvent<SidRadioWorkerToMain>) =>
        this.onMessage(event.data),
      );
      // A worker-side exception or a message that fails to deserialize never
      // reaches `message`; without these handlers the pending load/compute would
      // only resolve on the 15 s timeout. Fail fast instead.
      this.worker.addEventListener("error", (event) =>
        this.handleWorkerFailure(`SID Radio worker error: ${event.message || "unknown"}`),
      );
      this.worker.addEventListener("messageerror", () =>
        this.handleWorkerFailure("SID Radio worker message could not be deserialized"),
      );
    }
    return this.worker;
  }

  /**
   * Fail the callers of a worker that has crashed, and throw the worker away with them.
   *
   * Failing the callers alone left `this.worker` pointing at a thread that can never answer again.
   * `ensureWorker` only builds a new one when that field is null, so every later `load()` and
   * `compute()` posted into the dead worker and rejected on its own 15 s timeout — the station
   * never started again until the hook unmounted and called `terminate()`.
   */
  private handleWorkerFailure(reason: string): void {
    this.failAllPending(reason);
    this.discardWorker();
  }

  private discardWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    // A resolved memo would otherwise claim the bundle is loaded in a worker that no longer exists.
    this.loadInFlight = null;
  }

  /** Reject every in-flight load/compute so callers fail fast on a worker crash. */
  private failAllPending(reason: string): void {
    const error = new Error(reason);
    if (this.loadPending) {
      clearTimeout(this.loadPending.timer);
      this.loadPending.reject(error);
      this.loadPending = null;
    }
    for (const pending of this.computePending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.computePending.clear();
  }

  private onMessage(message: SidRadioWorkerToMain): void {
    if (message?.type === "ready") {
      const pending = this.loadPending;
      this.loadPending = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(message.stats);
      }
      return;
    }
    if (message?.type === "candidates" || message?.type === "empty") {
      const pending = this.computePending.get(message.id);
      if (!pending) return;
      this.computePending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(
        message.type === "candidates" ? { candidates: message.candidates } : { candidates: [], empty: message.reason },
      );
      return;
    }
    if (message?.type === "error") {
      const error = new Error(`SID Radio worker error [${message.code}]: ${message.message}`);
      if (typeof message.id === "number" && this.computePending.has(message.id)) {
        const pending = this.computePending.get(message.id)!;
        this.computePending.delete(message.id);
        clearTimeout(pending.timer);
        pending.reject(error);
      } else if (this.loadPending) {
        const pending = this.loadPending;
        this.loadPending = null;
        clearTimeout(pending.timer);
        pending.reject(error);
      }
    }
  }

  /**
   * Load the bundle in the worker and resolve with its ready stats.
   *
   * **Idempotent by contract.** Two loads legitimately overlap: the launcher
   * preloads to size its tiles, and a tile tap starts a station. Posting a
   * second `load` would replace this class's single pending resolver, so the
   * first caller would never be answered — it would reject on its 15 s timeout
   * with a spurious warning, and that stale timer would clear whichever load was
   * pending by then. Repeated calls therefore share one worker load, and with it
   * one parse of the 1.8 MB bundle that the worker keeps for `compute` anyway.
   *
   * A rejected load is not retained, so a caller can retry; `terminate()`
   * discards the worker and this memo together, since a resolved memo would
   * otherwise claim a bundle is loaded in a worker that no longer exists.
   * `options` from a later overlapping call are ignored, being a request to load
   * what is already loading.
   */
  load(options: SidRadioLoadOptions = {}): Promise<SidRadioReadyStats> {
    this.loadInFlight ??= this.postLoad(options).catch((error: unknown) => {
      this.loadInFlight = null;
      throw error;
    });
    return this.loadInFlight;
  }

  private postLoad(options: SidRadioLoadOptions): Promise<SidRadioReadyStats> {
    const { bundle, timeoutMs = 15000 } = options;
    return new Promise<SidRadioReadyStats>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        reject(error as Error);
        return;
      }
      const timer = setTimeout(() => {
        this.loadPending = null;
        reject(new Error(`SID Radio worker load timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.loadPending = { resolve, reject, timer };
      worker.postMessage({ type: "load", bundle }, bundle ? [bundle] : []);
    });
  }

  /**
   * Compute the next candidate batch for a station request (off the main thread).
   *
   * Waits for the bundle first. Only a worker that holds the bundle can answer a `compute` — it
   * replies `not-loaded` otherwise — and `load()` is memoised, so once the bundle is in this costs
   * nothing. It matters on the **resume** path: a station restored at launch rebuilds its queue
   * provider and refills straight away, and nothing on that path had loaded the bundle, so the
   * first refill raced the load and lost. On a Pixel 4 that surfaced as a burst of uncaught
   * "SID Radio worker error [not-loaded]: bundle not loaded" and, in Diagnostics, unhandled
   * promise rejections. Awaiting here fixes every caller rather than each new one remembering to.
   */
  async compute(request: StationRequest, timeoutMs = 15000): Promise<StationResult> {
    await this.load();
    return new Promise<StationResult>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        reject(error as Error);
        return;
      }
      const id = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        this.computePending.delete(id);
        reject(new Error(`SID Radio worker compute timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.computePending.set(id, { resolve, reject, timer });
      worker.postMessage({ type: "compute", id, request });
    });
  }

  terminate(): void {
    // Reject rather than merely clear: a caller awaiting `load()`/`compute()` at the
    // moment of termination (e.g. an unmounting component) would otherwise hang
    // forever, since its promise would neither resolve nor reject (HARD25-003).
    this.failAllPending("SID Radio worker terminated");
    this.discardWorker();
  }
}
