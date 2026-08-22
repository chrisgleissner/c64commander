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

/** A packed 4bpp frame with a solid square on a flat background — one object, one blob. */
const sceneFrame = (cx: number, cy: number, colour = 2, background = 6, size = 19): Uint8Array => {
  const frame = new Uint8Array(PAL_BYTES);
  frame.fill((background << 4) | background);
  for (let y = cy - (size - 1) / 2; y <= cy + (size - 1) / 2; y += 1) {
    for (let x = cx - (size - 1) / 2; x <= cx + (size - 1) / 2; x += 1) {
      const index = y * 384 + x;
      const byte = index >> 1;
      frame[byte] = (index & 1) === 1 ? (frame[byte] & 0x0f) | (colour << 4) : (frame[byte] & 0xf0) | colour;
    }
  }
  return frame;
};

describe("useMirrorViewport — locking on to an object", () => {
  afterEach(() => vi.useRealTimers());

  it("acquires on the next frame and reports what it locked on to", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake), follow: true }));

    expect(result.current.lock.state).toBe("idle");
    // The hook holds no frame of its own, so the pick is answered by the next one that arrives.
    act(() => result.current.lockOn(120 / 384, 100 / 272));
    expect(result.current.lock.state).toBe("idle");

    act(() => fake.emitFrame(sceneFrame(120, 100), 272));
    expect(result.current.lock.state).toBe("locked");
    expect((result.current.lock.subject?.x ?? 0) * 384).toBeCloseTo(120, 0);
    expect(result.current.lock.confidence).toBeGreaterThan(0.8);
  });

  it("moves the viewport with the object, once zoomed in and past the manual pause", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake), follow: true }));

    act(() => result.current.zoomBy(4));
    act(() => result.current.lockOn(80 / 384, 136 / 272));
    act(() => fake.emitFrame(sceneFrame(80, 136), 272));
    expect(result.current.lock.state).toBe("locked");

    // Past the manual pause the zoom started, then walk the object to the right.
    act(() => vi.setSystemTime(4000));
    const before = result.current.viewport.cx;
    for (let step = 1; step <= 24; step += 1) {
      act(() => {
        vi.setSystemTime(4000 + step * 60);
        fake.emitFrame(sceneFrame(80 + step * 6, 136), 272);
      });
    }
    expect(result.current.viewport.cx).toBeGreaterThan(before);
    expect(result.current.lock.state).toBe("locked");
  });

  it("refuses a pick on empty background instead of locking on to nothing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake), follow: true }));

    act(() => result.current.lockOn(320 / 384, 220 / 272));
    act(() => fake.emitFrame(sceneFrame(80, 60), 272));
    expect(result.current.lock.state).toBe("idle");
    expect(result.current.lock.subject).toBeNull();
  });

  it("gives the lock up on release, and on Fit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    const { result } = renderHook(() => useMirrorViewport({ session: asSession(fake), follow: true }));

    act(() => result.current.lockOn(120 / 384, 100 / 272));
    act(() => fake.emitFrame(sceneFrame(120, 100), 272));
    expect(result.current.lock.state).toBe("locked");

    act(() => result.current.releaseLock());
    expect(result.current.lock.state).toBe("idle");

    act(() => result.current.lockOn(120 / 384, 100 / 272));
    act(() => fake.emitFrame(sceneFrame(120, 100), 272));
    expect(result.current.lock.state).toBe("locked");
    // Asking for the whole picture is asking to stop following one thing.
    act(() => result.current.reset());
    expect(result.current.lock.state).toBe("idle");
  });

  it("feeds the player's own joystick to the tracker, and works without it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    // The cue is optional in both directions: it must be safe to pass a held set from the very
    // first render, and safe never to pass one at all.
    const { result, rerender } = renderHook(
      (held: Set<string>) =>
        useMirrorViewport({
          session: asSession(fake),
          follow: true,
          heldJoystickInputs: held as ReadonlySet<never>,
        }),
      { initialProps: new Set<string>() },
    );

    act(() => result.current.lockOn(120 / 384, 100 / 272));
    act(() => fake.emitFrame(sceneFrame(120, 100), 272));
    expect(result.current.lock.state).toBe("locked");

    // Hold right, and walk the object right — the case the cue is for.
    rerender(new Set(["right"]));
    let x = 120;
    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        vi.setSystemTime(1000 + step * 60);
        x += 4;
        fake.emitFrame(sceneFrame(x, 100), 272);
      });
    }
    expect(result.current.lock.state).toBe("locked");
    expect((result.current.lock.subject?.x ?? 0) * 384).toBeCloseTo(x, -1);
  });

  it("drops the lock when follow is turned off", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fake = new FakeSession();
    const { result, rerender } = renderHook(
      (follow: boolean) => useMirrorViewport({ session: asSession(fake), follow }),
      { initialProps: true },
    );

    act(() => result.current.lockOn(120 / 384, 100 / 272));
    act(() => fake.emitFrame(sceneFrame(120, 100), 272));
    expect(result.current.lock.state).toBe("locked");

    rerender(false);
    expect(result.current.lock.state).toBe("idle");
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
