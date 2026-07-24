/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMirrorViewport } from "@/hooks/useMirrorViewport";
import { MAX_SCALE } from "@/lib/streams/mirrorViewport";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

class FakeSession {
  private frameListeners = new Set<(f: Uint8Array, h: number) => void>();
  subscribe() {
    return () => {};
  }
  getSnapshot() {
    return {
      audio: { state: "off", droppedPackets: 0, error: null },
      video: { state: "off", fps: 0, error: null },
    };
  }
  subscribeFrames(handler: (f: Uint8Array, h: number) => void) {
    this.frameListeners.add(handler);
    return () => this.frameListeners.delete(handler);
  }
  emitFrame(frame: Uint8Array, height: number) {
    this.frameListeners.forEach((h) => h(frame, height));
  }
  get frameSubscriberCount() {
    return this.frameListeners.size;
  }
}

const asSession = (fake: FakeSession) => fake as unknown as AvMirrorSession;

/** PAL frame: 384x272 packed 4bpp = 52224 bytes. */
const PAL_BYTES = (384 * 272) / 2;

describe("useMirrorViewport — manual ops", () => {
  afterEach(() => vi.useRealTimers());

  it("starts fit and zooms/pans/resets via the pure viewport math", () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake) }));

    expect(result.current.viewport).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });

    act(() => result.current.zoomBy(2));
    expect(result.current.viewport.scale).toBe(2);

    act(() => result.current.panBy(0.2, -0.1));
    expect(result.current.viewport.cx).toBeGreaterThan(0.5);
    expect(result.current.viewport.cy).toBeLessThan(0.5);

    act(() => result.current.reset());
    expect(result.current.viewport).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
  });

  it("centerOn clamps to the visible bounds and setScale clamps to [1, MAX]", () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake) }));

    act(() => result.current.setScale(4));
    expect(result.current.viewport.scale).toBe(4);
    // at scale 4 the centre is clamped to [0.125, 0.875]
    act(() => result.current.centerOn(1, 1));
    expect(result.current.viewport.cx).toBeCloseTo(0.875, 5);
    expect(result.current.viewport.cy).toBeCloseTo(0.875, 5);

    act(() => result.current.setScale(9999));
    expect(result.current.viewport.scale).toBe(MAX_SCALE);
    act(() => result.current.setScale(0.01));
    expect(result.current.viewport.scale).toBe(1);
  });

  it("does not subscribe to frames when follow is off", () => {
    const fake = new FakeSession();
    renderHook(() => useMirrorViewport({ session: asSession(fake), follow: false }));
    expect(fake.frameSubscriberCount).toBe(0);
  });
});

describe("useMirrorViewport — smart follow", () => {
  afterEach(() => vi.useRealTimers());

  it("subscribes while follow is on and unsubscribes when it turns off", () => {
    const fake = new FakeSession();
    const { rerender, unmount } = renderHook(
      (follow: boolean) => useMirrorViewport({ session: asSession(fake), follow }),
      {
        initialProps: true,
      },
    );
    expect(fake.frameSubscriberCount).toBe(1);
    rerender(false);
    expect(fake.frameSubscriberCount).toBe(0);
    rerender(true);
    expect(fake.frameSubscriberCount).toBe(1);
    unmount();
    expect(fake.frameSubscriberCount).toBe(0);
  });

  it("ignores motion while essentially fit (scale below the follow threshold)", () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake), follow: true }));
    const before = { ...result.current.viewport };

    const a = new Uint8Array(PAL_BYTES);
    const b = new Uint8Array(PAL_BYTES);
    for (let i = 150; i <= 164; i += 2) b[i] = 0xff; // right-side change, line 0
    act(() => {
      fake.emitFrame(a, 272); // seed
      fake.emitFrame(b, 272); // motion — but scale is 1, below FOLLOW_MIN_SCALE
    });
    expect(result.current.viewport).toEqual(before);
  });

  it("eases the viewport toward on-screen activity once zoomed and past the manual pause", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake), follow: true }));

    // Zoom in (marks a manual pause until t=2500).
    act(() => result.current.zoomBy(2));
    expect(result.current.viewport.scale).toBe(2);
    const cxBefore = result.current.viewport.cx;

    // Advance past the manual-follow pause, then feed motion on the right side.
    vi.setSystemTime(3000);
    const a = new Uint8Array(PAL_BYTES);
    const b = new Uint8Array(PAL_BYTES);
    for (let i = 150; i <= 164; i += 2) b[i] = 0xff; // centroid x ≈ 0.82
    act(() => {
      fake.emitFrame(a, 272); // seed baseline
      fake.emitFrame(b, 272); // motion → ease centre rightward
    });
    expect(result.current.viewport.cx).toBeGreaterThan(cxBefore);
  });

  it("lets a manual pan win over follow for a moment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake), follow: true }));
    act(() => result.current.zoomBy(2));

    // zoomBy at t=1000 paused follow until t=2500; at t=1100 motion must be ignored.
    vi.setSystemTime(1100);
    const snapshot = { ...result.current.viewport };
    const a = new Uint8Array(PAL_BYTES);
    const b = new Uint8Array(PAL_BYTES);
    for (let i = 150; i <= 164; i += 2) b[i] = 0xff;
    act(() => {
      fake.emitFrame(a, 272);
      fake.emitFrame(b, 272);
    });
    expect(result.current.viewport).toEqual(snapshot);
  });
});
