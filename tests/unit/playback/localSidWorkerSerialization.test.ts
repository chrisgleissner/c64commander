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
  async setSystemROMs(_kernal: Uint8Array | null, _basic: Uint8Array | null, _chargen: Uint8Array | null) {
    await Promise.resolve();
  }
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

vi.mock("/wasm/libsidplayfp/dist/index.js", () => ({ SidAudioEngine: FakeSidAudioEngine }), { virtual: true });

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

/**
 * Drains until the worker has done a named piece of work, rather than for a fixed number of ticks.
 * The engine module arrives through a dynamic `import()`, whose cost is Vite's transform pipeline
 * and therefore the load on the machine: in the whole-suite run of 976ee5ef5 the 12 ticks above
 * elapsed before `open` had finished, leaving the four queued renders unstarted and
 * `peakConcurrent` at 0. A stall still fails here — the wait is bounded and the assertion unchanged.
 */
const drainUntil = async (done: () => boolean, ticks = 400) => {
  for (let i = 0; i < ticks && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const opened = () => posted.some((message) => message.type === "opened");
const chunkCount = () => posted.filter((message) => message.type === "chunk").length;

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

/**
 * The worker refuses to start without C64 ROMs — without KERNAL/BASIC
 * libsidplayfp initialises a tune and never advances it, so routing to the C64
 * is the only correct answer (see docs/plans/sid-station/AUDIO-FIDELITY-TEST.md
 * §6.2). These tests are about message *ordering*, not ROM validity, and the
 * engine is stubbed here, so any two buffers of the right shape will do. Fresh
 * ones per call because posting transfers them.
 */
const FAKE_ROMS = () => ({ kernal: new Uint8Array(8192).buffer, basic: new Uint8Array(8192).buffer });

describe("localSid.worker message serialization", () => {
  it("marks itself as running in a worker", () => {
    expect(scope.__runsInWorker).toBe(true);
  });

  it("never runs two renderSeconds calls at once, however many are in flight", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 1,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    await drainUntil(opened);

    // The engine pumps up to MAX_IN_FLIGHT_RENDERS renders back-to-back.
    for (let i = 0; i < 4; i += 1) {
      send({ type: "render", id: 1, seconds: 0.5 } as LocalSidMainToWorker);
    }
    await drainUntil(() => chunkCount() >= 4);

    expect(peakConcurrent, `opened=${opened()} chunks=${chunkCount()} renderOrder=${renderOrder.join(",")}`).toBe(1);
  });

  it("renders consecutive spans in order — no span is replayed", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 1,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    await drainUntil(opened);
    for (let i = 0; i < 4; i += 1) {
      send({ type: "render", id: 1, seconds: 0.5 } as LocalSidMainToWorker);
    }
    await drainUntil(() => chunkCount() >= 4);

    expect(renderOrder).toEqual([0, 1, 2, 3]);
    const chunks = posted.filter((m) => m.type === "chunk") as Extract<LocalSidWorkerToMain, { type: "chunk" }>[];
    expect(chunks).toHaveLength(4);
    // Each chunk carries a distinct span stamp, in order.
    expect(chunks.map((c) => c.pcm[0])).toEqual([0, 1, 2, 3]);
  });

  it("keeps ordering a render behind the open that replaces the engine", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 1,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    send({ type: "render", id: 1, seconds: 0.5 } as LocalSidMainToWorker);
    await drainUntil(() => chunkCount() >= 1);

    const types = posted.map((m) => m.type);
    expect(types.indexOf("opened")).toBeLessThan(types.indexOf("chunk"));
    expect(peakConcurrent, `opened=${opened()} chunks=${chunkCount()}`).toBe(1);
  });

  /**
   * The queue is strictly ordered, which is what makes it safe — and what made a track change
   * fail. A scrub leaves renders and seeks queued for the tune being left; the next tune's `open`
   * waits behind every one of them, and a seek renders and discards everything between the
   * current position and its target. On a Pixel 4 that was enough to blow the open's 15 s timeout,
   * and the app reported "Local SID engine did not open the tune within 15000ms" with the worker
   * thrown away as unresponsive. Nobody can hear work done for a tune already left, so it is
   * skipped rather than merely ignored on arrival.
   */
  it("drops the outgoing tune's queued renders so the next open is not stuck behind them", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 1,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    await drain();

    // A scrub's worth of backlog, then the listener skips to the next tune.
    for (let i = 0; i < 4; i += 1) send({ type: "render", id: 1, seconds: 0.5 } as LocalSidMainToWorker);
    send({ type: "seek", id: 2, positionSeconds: 120 } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 3,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    await drain();

    // At most the one call already running when the open was received; the rest are skipped.
    expect(renderOrder.length).toBeLessThanOrEqual(1);
    const opened = posted.filter((m) => m.type === "opened") as Extract<LocalSidWorkerToMain, { type: "opened" }>[];
    expect(opened.map((m) => m.id)).toContain(3);
  });

  it("still answers a superseded seek rather than leaving its caller waiting", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 1,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    await drain();

    send({ type: "seek", id: 7, positionSeconds: 90 } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 8,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    await drain();

    // The reply costs nothing, and a caller awaiting this seek should not sit out its timeout.
    const seeked = posted.filter((m) => m.type === "seeked") as Extract<LocalSidWorkerToMain, { type: "seeked" }>[];
    expect(seeked.map((m) => m.id)).toContain(7);
  });

  it("a failing message does not break the chain for later ones", async () => {
    send({ type: "load" } as LocalSidMainToWorker);
    // No engine open yet → render reports `end` rather than throwing.
    send({ type: "render", id: 9, seconds: 0.5 } as LocalSidMainToWorker);
    send({
      type: "open",
      id: 2,
      sidBytes: new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer,
      songIndex: 0,
      sampleRate: 48000,
      roms: FAKE_ROMS(),
    } as LocalSidMainToWorker);
    send({ type: "render", id: 2, seconds: 0.5 } as LocalSidMainToWorker);
    await drain();

    expect(posted.some((m) => m.type === "opened")).toBe(true);
    expect(posted.some((m) => m.type === "chunk")).toBe(true);
  });
});
