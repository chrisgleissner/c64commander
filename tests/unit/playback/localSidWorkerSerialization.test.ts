/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

/**
 * Regression guard for the on-device engine's worst audible bug: a short
 * passage looping over and over with crackle at the seams.
 *
 * `SidAudioEngine` is one stateful WASM instance and `renderSeconds()` advances
 * the emulated machine from wherever it left off — it is not reentrant. The
 * worker's listener was `async`, so every `await` yielded to the next queued
 * message and N in-flight renders became N concurrent `renderSeconds()` calls
 * on that single engine. They interleaved and replayed the same span.
 *
 * These tests drive the real worker module with a fake engine that records how
 * many renders overlap.
 */

/** Peak concurrency observed inside the fake engine's renderSeconds. */
let concurrent = 0;
let peakConcurrent = 0;
/** Monotonic position the fake engine renders from, proving no span repeats. */
let position = 0;
let renderOrder: number[] = [];

class FakeSidAudioEngine {
  constructor(_options: { sampleRate?: number; stereo?: boolean }) {}
  async loadSidBuffer(_data: Uint8Array, _songIndex?: number): Promise<void> {
    await Promise.resolve();
  }
  getSampleRate(): number {
    return 48000;
  }
  getChannels(): number {
    return 2;
  }
  getTuneInfo(): Record<string, unknown> | null {
    return { title: "fake" };
  }
  async renderSeconds(seconds: number): Promise<Int16Array> {
    concurrent += 1;
    peakConcurrent = Math.max(peakConcurrent, concurrent);
    // Yield twice: with a bare async listener this is where the next queued
    // render used to slip in and start rendering the same span.
    await Promise.resolve();
    await Promise.resolve();
    const frames = Math.round(seconds * 100);
    const pcm = new Int16Array(frames * 2);
    // Stamp the span this call rendered so overlap is detectable in the output.
    pcm.fill(position);
    renderOrder.push(position);
    position += 1;
    concurrent -= 1;
    return pcm;
  }
  dispose(): void {}
}

vi.mock("/wasm/libsidplayfp/index.js", () => ({ SidAudioEngine: FakeSidAudioEngine }), { virtual: true });

interface FakeScope {
  postMessage: (message: LocalSidWorkerToMain, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<LocalSidMainToWorker>) => void) | null;
  __runsInWorker?: boolean;
}

let scope: FakeScope;
let posted: LocalSidWorkerToMain[];
const originalSelf = globalThis.self;

/** Deliver a message to the worker exactly as the runtime would. */
const send = (message: LocalSidMainToWorker) => {
  scope.onmessage?.({ data: message } as MessageEvent<LocalSidMainToWorker>);
};

/**
 * Let the worker's promise chain drain. Uses macrotasks, not bare microtasks:
 * the worker resolves its engine module through a dynamic `import()`, which
 * does not settle within a microtask drain.
 */
const drain = async (ticks = 12) => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

// The worker module captures `self` once at evaluation time, so the scope is
// installed and the module imported exactly once; per-test state is reset below.
beforeAll(async () => {
  posted = [];
  scope = {
    postMessage: (message) => posted.push(message),
    onmessage: null,
  };
  Object.defineProperty(globalThis, "self", { value: scope, configurable: true, writable: true });
  await import("@/lib/playback/localSid.worker");
});

afterAll(() => {
  Object.defineProperty(globalThis, "self", { value: originalSelf, configurable: true, writable: true });
});

beforeEach(async () => {
  // Let any work queued by the previous test finish before resetting counters.
  await drain();
  concurrent = 0;
  peakConcurrent = 0;
  position = 0;
  renderOrder = [];
  posted.length = 0;
});

describe("localSid.worker message serialization", () => {
  it("marks itself as running in a worker", () => {
    expect(scope.__runsInWorker).toBe(true);
  });

  it("never runs two renderSeconds calls at once, however many are in flight", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({ type: "open", id: 1, sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer, songIndex: 0, sampleRate: 48000 } as LocalSidMainToWorker);
    await drain();

    // The engine pumps up to MAX_IN_FLIGHT_RENDERS renders back-to-back.
    for (let i = 0; i < 4; i += 1) {
      send({ type: "render", id: 1, seconds: 0.5 } as LocalSidMainToWorker);
    }
    await drain();

    expect(peakConcurrent).toBe(1);
  });

  it("renders consecutive spans in order — no span is replayed", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({ type: "open", id: 1, sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer, songIndex: 0, sampleRate: 48000 } as LocalSidMainToWorker);
    await drain();
    for (let i = 0; i < 4; i += 1) {
      send({ type: "render", id: 1, seconds: 0.5 } as LocalSidMainToWorker);
    }
    await drain();

    expect(renderOrder).toEqual([0, 1, 2, 3]);
    const chunks = posted.filter((m) => m.type === "chunk") as Extract<LocalSidWorkerToMain, { type: "chunk" }>[];
    expect(chunks).toHaveLength(4);
    // Each chunk carries a distinct span stamp, in order.
    expect(chunks.map((c) => c.pcm[0])).toEqual([0, 1, 2, 3]);
  });

  it("keeps ordering a render behind the open that replaces the engine", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({ type: "open", id: 1, sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer, songIndex: 0, sampleRate: 48000 } as LocalSidMainToWorker);
    send({ type: "render", id: 1, seconds: 0.5 } as LocalSidMainToWorker);
    await drain();

    const types = posted.map((m) => m.type);
    expect(types.indexOf("opened")).toBeLessThan(types.indexOf("chunk"));
    expect(peakConcurrent).toBe(1);
  });

  it("a failing message does not break the chain for later ones", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    // No engine open yet → render reports `end` rather than throwing.
    send({ type: "render", id: 9, seconds: 0.5 } as LocalSidMainToWorker);
    send({ type: "open", id: 2, sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer, songIndex: 0, sampleRate: 48000 } as LocalSidMainToWorker);
    send({ type: "render", id: 2, seconds: 0.5 } as LocalSidMainToWorker);
    await drain();

    expect(posted.some((m) => m.type === "opened")).toBe(true);
    expect(posted.some((m) => m.type === "chunk")).toBe(true);
  });
});
