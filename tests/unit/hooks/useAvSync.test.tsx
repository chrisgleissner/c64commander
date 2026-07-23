/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAvSync } from "@/hooks/useAvSync";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

const { runAvSyncTest } = vi.hoisted(() => ({ runAvSyncTest: vi.fn().mockResolvedValue({ errors: [] }) }));
vi.mock("@/lib/streams/avSyncPrg", () => ({ runAvSyncTest }));

const FRAME_BYTES = (384 * 272) / 2;
const white = () => new Uint8Array(FRAME_BYTES).fill(0x11);
const black = () => new Uint8Array(FRAME_BYTES);
const loud = () => new Int16Array(768).fill(8000);
const silent = () => new Int16Array(768);

class FakeSession {
  private frameHandlers = new Set<(f: Uint8Array, h: number, arrivalMs: number) => void>();
  private audioHandlers = new Set<(s: Int16Array, arrivalMs: number) => void>();
  // Monotonic wire clock: each emit advances 10 ms, mirroring native arrival stamps.
  private clock = 1000;
  subscribeFrames(handler: (f: Uint8Array, h: number, arrivalMs: number) => void) {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }
  subscribeAudio(handler: (s: Int16Array, arrivalMs: number) => void) {
    this.audioHandlers.add(handler);
    return () => this.audioHandlers.delete(handler);
  }
  emitFrame(frame: Uint8Array, t: number = (this.clock += 10)) {
    this.frameHandlers.forEach((h) => h(frame, 272, t));
  }
  emitAudio(samples: Int16Array, t: number = (this.clock += 10)) {
    this.audioHandlers.forEach((h) => h(samples, t));
  }
  get frameSubs() {
    return this.frameHandlers.size;
  }
  get audioSubs() {
    return this.audioHandlers.size;
  }
}

const asSession = (fake: FakeSession) => fake as unknown as AvMirrorSession;

describe("useAvSync", () => {
  beforeEach(() => runAvSyncTest.mockClear());

  it("feeds session frames/audio into the analyzer and records a matched pop", () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvSync(asSession(fake)));
    expect(result.current.stats.count).toBe(0);

    act(() => {
      fake.emitFrame(black()); // prime video baseline + arm
      fake.emitAudio(silent()); // prime audio baseline + arm
      fake.emitFrame(white()); // video pop
      fake.emitFrame(black()); // re-arm video
      fake.emitAudio(loud()); // audio pop → matches (within window)
    });

    expect(result.current.stats.count).toBe(1);
    expect(result.current.stats.lastMs).not.toBeNull();
  });

  it("runTest uploads the program and resets clears the stats", async () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvSync(asSession(fake)));

    await act(async () => {
      await result.current.runTest();
    });
    expect(runAvSyncTest).toHaveBeenCalledTimes(1);
    expect(result.current.runningTest).toBe(false);

    act(() => {
      fake.emitFrame(black());
      fake.emitAudio(silent());
      fake.emitFrame(white());
      fake.emitFrame(black());
      fake.emitAudio(loud());
    });
    expect(result.current.stats.count).toBe(1);

    act(() => result.current.reset());
    expect(result.current.stats.count).toBe(0);
    expect(result.current.stats.lastMs).toBeNull();
  });

  it("surfaces a test-start failure", async () => {
    runAvSyncTest.mockRejectedValueOnce(new Error("device offline"));
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvSync(asSession(fake)));
    await act(async () => {
      await result.current.runTest();
    });
    await waitFor(() => expect(result.current.testError).toBe("device offline"));
  });

  it("unsubscribes from the session on unmount", () => {
    const fake = new FakeSession();
    const { unmount } = renderHook(() => useAvSync(asSession(fake)));
    expect(fake.frameSubs).toBe(1);
    expect(fake.audioSubs).toBe(1);
    unmount();
    expect(fake.frameSubs).toBe(0);
    expect(fake.audioSubs).toBe(0);
  });
});
