/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Automated E2E for the space-triggered A/V latency flow, with the C64 mocked out (runs on every
 * build). A mock device answers each SPACE keypress (machine:input) by emitting one aligned A/V
 * pop back through the shared session — as the real av-sync-key program does — over a "perfect"
 * network. It drives the SHIPPED useAvSync hook end to end and asserts the app measures:
 *
 *   - press → see  latency P99 < 30 ms
 *   - press → hear latency P99 < 30 ms
 *   - A/V offset   P99 < 20 ms
 *
 * A controllable clock (performance.now) makes the perceived latencies deterministic; the video
 * and audio wire timestamps make the offset deterministic — so the thresholds are asserted
 * exactly, not against wall-clock noise.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAvSync } from "@/hooks/useAvSync";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

const { sendMachineInputBatch, runPrgUpload } = vi.hoisted(() => ({
  sendMachineInputBatch: vi.fn(async () => ({})),
  runPrgUpload: vi.fn(async () => ({ errors: [] as string[] })),
}));
vi.mock("@/lib/c64api", () => ({ getC64API: () => ({ sendMachineInputBatch, runPrgUpload }) }));

const FRAME_BYTES = (384 * 272) / 2;
const white = () => new Uint8Array(FRAME_BYTES).fill(0x11);
const black = () => new Uint8Array(FRAME_BYTES);
const loud = () => new Int16Array(768).fill(8000);
const silent = () => new Int16Array(768);

/** Fake shared session whose frame/audio feeds the test drives with explicit wire timestamps. */
class FakeSession {
  private frameHandlers = new Set<(f: Uint8Array, h: number, t: number) => void>();
  private audioHandlers = new Set<(s: Int16Array, t: number) => void>();
  subscribeFrames(h: (f: Uint8Array, height: number, t: number) => void) {
    this.frameHandlers.add(h);
    return () => this.frameHandlers.delete(h);
  }
  subscribeAudio(h: (s: Int16Array, t: number) => void) {
    this.audioHandlers.add(h);
    return () => this.audioHandlers.delete(h);
  }
  emitFrame(frame: Uint8Array, wireMs: number) {
    this.frameHandlers.forEach((h) => h(frame, 272, wireMs));
  }
  emitAudio(samples: Int16Array, wireMs: number) {
    this.audioHandlers.forEach((h) => h(samples, wireMs));
  }
}

const asSession = (fake: FakeSession) => fake as unknown as AvMirrorSession;

let clock = 0;
const setClock = (v: number) => {
  clock = v;
};

beforeEach(() => {
  sendMachineInputBatch.mockClear();
  runPrgUpload.mockClear();
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

describe("useAvSync — interactive space-triggered latency (mock C64, perfect network)", () => {
  it("measures press→see/hear < 30 ms and A/V offset < 20 ms across many taps", async () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvSync(asSession(fake)));

    // Perfect-network device response: video pop ~8 ms after the press, audio ~10 ms; the pop's
    // two streams arrive 3 ms apart on the wire (a tight, in-sync pop).
    const SEE_LATENCY = 8;
    const HEAR_LATENCY = 10;
    const WIRE_OFFSET = 3;

    let wire = 100_000; // monotonic wire clock (native-style), independent of the observe clock
    for (let i = 0; i < 40; i++) {
      const pressAt = 1000 + i * 1000;

      // Re-arm the detectors with a dark/quiet baseline before the tap.
      setClock(pressAt - 50);
      act(() => {
        fake.emitFrame(black(), wire);
        fake.emitAudio(silent(), wire);
      });
      wire += 20;

      // Press SPACE.
      setClock(pressAt);
      await act(async () => {
        await result.current.pressSpace();
      });
      expect(sendMachineInputBatch).toHaveBeenCalled();

      // Device answers: the aligned pop arrives back over the two streams.
      const videoWire = wire;
      const audioWire = wire + WIRE_OFFSET;
      setClock(pressAt + SEE_LATENCY);
      act(() => fake.emitFrame(white(), videoWire));
      setClock(pressAt + HEAR_LATENCY);
      act(() => fake.emitAudio(loud(), audioWire));
      wire += 100;
    }

    const s = result.current.latencyStats;
    expect(s.count).toBe(40);
    expect(s.missed).toBe(0);
    expect(s.seeP99Ms!).toBeLessThan(30);
    expect(s.hearP99Ms!).toBeLessThan(30);
    expect(s.offsetP99Ms!).toBeLessThan(20);
    // And the measurements are the real values, not trivially zero.
    expect(s.seeP99Ms!).toBeCloseTo(SEE_LATENCY, 0);
    expect(s.offsetP99Ms!).toBeCloseTo(WIRE_OFFSET, 0);
  });

  it("loads the space program via runKeyTest", async () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvSync(asSession(fake)));
    await act(async () => {
      await result.current.runKeyTest();
    });
    expect(runPrgUpload).toHaveBeenCalledTimes(1);
  });
});
