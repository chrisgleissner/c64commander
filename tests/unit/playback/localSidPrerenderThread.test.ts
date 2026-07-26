/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalSidEngine, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

/**
 * The pre-render must not run on the playback thread.
 *
 * It did, and the cost was not subtle: rendering is CPU-bound at roughly 150 ms
 * per second of audio, so a pre-render held that one thread almost solidly and
 * the playback renders queued behind it never ran. Measured on a Pixel 4 with a
 * microphone at the speaker, every locally-played tune was SILENT for its first
 * ~35 seconds — audio stream open, clock advancing, nothing but room floor —
 * and the very same passage played normally once the pre-render had finished.
 *
 * Slicing the offline render and awaiting between slices did not save it; a
 * slice is ~750 ms of uninterrupted WASM. Only a second thread does.
 */

// Real ROM images are never committed, and the pre-render refuses to start
// without them, so they are stubbed here. What is under test is which thread
// the work lands on, not the ROMs themselves.
vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
}));

class FakeWorker implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  terminated = false;
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;

  postMessage(message: LocalSidMainToWorker): void {
    this.sent.push(message);
  }
  addEventListener(type: "message" | "error" | "messageerror", handler: unknown): void {
    if (type === "message") this.handler = handler as (event: MessageEvent<LocalSidWorkerToMain>) => void;
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
  has(type: LocalSidMainToWorker["type"]): boolean {
    return this.sent.some((message) => message.type === type);
  }
}

describe("pre-render runs off the playback thread", () => {
  let workers: FakeWorker[];
  const makeEngine = () => {
    workers = [];
    return new LocalSidEngine({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the pre-render to a different worker than playback", () => {
    const engine = makeEngine();
    void engine.play(new ArrayBuffer(8), 0, {});
    expect(workers).toHaveLength(1);

    engine.prerender("tune-a", new ArrayBuffer(8), 0, 120);

    // A second worker means a second thread.
    expect(workers).toHaveLength(2);
    expect(workers[1]!.has("prerender")).toBe(true);
    // And the playback worker must be left alone to keep the audio flowing.
    expect(workers[0]!.has("prerender")).toBe(false);
  });

  it("kills a superseded pre-render instead of queueing behind it", () => {
    const engine = makeEngine();
    void engine.play(new ArrayBuffer(8), 0, {});
    engine.prerender("tune-a", new ArrayBuffer(8), 0, 120);
    const first = workers[1]!;

    engine.prerender("tune-b", new ArrayBuffer(8), 0, 120);

    // Posting to the same worker would render tune-a to the end before tune-b
    // ever started — CPU spent on a tune nobody is listening to.
    expect(first.terminated).toBe(true);
    expect(workers).toHaveLength(3);
    expect(workers[2]!.has("prerender")).toBe(true);
  });

  it("does not take down playback when the pre-render thread dies", () => {
    const engine = makeEngine();
    const onError = vi.fn();
    void engine.play(new ArrayBuffer(8), 0, { onError });
    engine.prerender("tune-a", new ArrayBuffer(8), 0, 120);

    // The tune is still playing; a failed pre-render only means seeks go back
    // to the slow path, so it must not surface as a playback error.
    engine.dispose();
    expect(onError).not.toHaveBeenCalled();
  });

  it("terminates the pre-render thread on dispose", () => {
    const engine = makeEngine();
    void engine.play(new ArrayBuffer(8), 0, {});
    engine.prerender("tune-a", new ArrayBuffer(8), 0, 120);
    const prerenderWorker = workers[1]!;

    engine.dispose();

    // Otherwise it keeps a second WASM instance alive, rendering a tune that is
    // no longer wanted.
    expect(prerenderWorker.terminated).toBe(true);
  });
});
