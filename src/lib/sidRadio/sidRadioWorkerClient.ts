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
    }
    return this.worker;
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

  load(options: SidRadioLoadOptions = {}): Promise<SidRadioReadyStats> {
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

  /** Compute the next candidate batch for a station request (off the main thread). */
  compute(request: StationRequest, timeoutMs = 15000): Promise<StationResult> {
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
    this.worker?.terminate();
    this.worker = null;
    if (this.loadPending) {
      clearTimeout(this.loadPending.timer);
      this.loadPending = null;
    }
    for (const pending of this.computePending.values()) clearTimeout(pending.timer);
    this.computePending.clear();
  }
}
