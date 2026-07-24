/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SidRadioReadyStats, SidRadioWorkerToMain } from "./sidRadioWorkerProtocol";

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

export class SidRadioWorkerClient {
  private worker: Worker | null = null;

  constructor(private readonly factory: SidRadioWorkerFactory = defaultWorkerFactory) {}

  /** True when the engine can run off-main-thread in this environment. */
  static isSupported(): boolean {
    return typeof Worker !== "undefined";
  }

  private ensureWorker(): Worker {
    if (!this.worker) this.worker = this.factory();
    return this.worker;
  }

  load(options: SidRadioLoadOptions = {}): Promise<SidRadioReadyStats> {
    const { bundle, timeoutMs = 15000 } = options;
    return new Promise<SidRadioReadyStats>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        reject(error);
        return;
      }

      const onMessage = (event: MessageEvent<SidRadioWorkerToMain>) => {
        const message = event.data;
        if (message?.type === "ready") {
          cleanup();
          resolve(message.stats);
        } else if (message?.type === "error") {
          cleanup();
          reject(new Error(`SID Radio worker error [${message.code}]: ${message.message}`));
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SID Radio worker load timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
      };

      worker.addEventListener("message", onMessage);
      worker.postMessage({ type: "load", bundle }, bundle ? [bundle] : []);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
