/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAvMirror, useAvMirrorCanvas } from "@/hooks/useAvMirror";
import type { AvMirrorSession, AvMirrorSnapshot } from "@/lib/streams/avMirrorSession";

/** Minimal stand-in for the shared session; lets a test push snapshots / frames. */
class FakeSession {
  private snapshot: AvMirrorSnapshot = {
    audio: { state: "off", droppedPackets: 0, error: null },
    video: { state: "off", fps: 0, error: null },
  };
  private listeners = new Set<(s: AvMirrorSnapshot) => void>();
  private frameListeners = new Set<(f: Uint8Array, h: number) => void>();
  toggleAudio = vi.fn(async () => {});
  toggleVideo = vi.fn(async () => {});
  stopAll = vi.fn(async () => {});
  getSnapshot() {
    return this.snapshot;
  }
  subscribe(listener: (s: AvMirrorSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }
  subscribeFrames(handler: (f: Uint8Array, h: number) => void) {
    this.frameListeners.add(handler);
    return () => this.frameListeners.delete(handler);
  }
  push(snapshot: AvMirrorSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((l) => l(snapshot));
  }
  emitFrame(frame: Uint8Array, height: number) {
    this.frameListeners.forEach((h) => h(frame, height));
  }
  get frameSubscriberCount() {
    return this.frameListeners.size;
  }
}

const asSession = (fake: FakeSession) => fake as unknown as AvMirrorSession;

describe("useAvMirror", () => {
  it("derives live/anyLive flags and re-renders on snapshot change", () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvMirror(asSession(fake)));

    expect(result.current.audioLive).toBe(false);
    expect(result.current.videoLive).toBe(false);
    expect(result.current.anyLive).toBe(false);

    act(() => {
      fake.push({
        audio: { state: "live", droppedPackets: 0, error: null },
        video: { state: "off", fps: 0, error: null },
      });
    });
    expect(result.current.audioLive).toBe(true);
    expect(result.current.anyLive).toBe(true);
    expect(result.current.videoLive).toBe(false);

    act(() => {
      fake.push({
        audio: { state: "off", droppedPackets: 0, error: null },
        video: { state: "connecting", fps: 0, error: null },
      });
    });
    expect(result.current.videoLive).toBe(true); // connecting counts as live
  });

  it("forwards toggle/stop callbacks to the session", async () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvMirror(asSession(fake)));
    await act(async () => {
      await result.current.toggleAudio();
      await result.current.toggleVideo();
      await result.current.stopAll();
    });
    expect(fake.toggleAudio).toHaveBeenCalledTimes(1);
    expect(fake.toggleVideo).toHaveBeenCalledTimes(1);
    expect(fake.stopAll).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", () => {
    const fake = new FakeSession();
    const { unmount } = renderHook(() => useAvMirror(asSession(fake)));
    unmount();
    // pushing after unmount must not throw (listener removed)
    expect(() =>
      fake.push({
        audio: { state: "live", droppedPackets: 0, error: null },
        video: { state: "off", fps: 0, error: null },
      }),
    ).not.toThrow();
  });
});

describe("useAvMirrorCanvas", () => {
  const makeStubCanvas = () => {
    const putImageData = vi.fn();
    const createImageData = vi.fn((w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }));
    const canvas = {
      height: 0,
      getContext: vi.fn(() => ({ createImageData, putImageData })),
    } as unknown as HTMLCanvasElement;
    return { canvas, putImageData, createImageData };
  };

  it("decodes a frame into the canvas and re-sizes for the frame height", () => {
    const fake = new FakeSession();
    const { canvas, putImageData, createImageData } = makeStubCanvas();
    const ref = { current: canvas };
    renderHook(() => useAvMirrorCanvas(ref, asSession(fake)));

    // a PAL frame (384x272 4bpp = 52224 bytes)
    act(() => fake.emitFrame(new Uint8Array(384 * 272), 272));
    expect(createImageData).toHaveBeenCalledWith(384, 272);
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(canvas.height).toBe(272);

    // an NTSC frame re-sizes the backing ImageData
    act(() => fake.emitFrame(new Uint8Array(384 * 240), 240));
    expect(createImageData).toHaveBeenLastCalledWith(384, 240);
    expect(canvas.height).toBe(240);
  });

  it("no-ops when the canvas has no 2d context (jsdom) and unsubscribes on unmount", () => {
    const fake = new FakeSession();
    const canvas = { height: 0, getContext: vi.fn(() => null) } as unknown as HTMLCanvasElement;
    const ref = { current: canvas };
    const { unmount } = renderHook(() => useAvMirrorCanvas(ref, asSession(fake)));
    expect(fake.frameSubscriberCount).toBe(1);
    act(() => fake.emitFrame(new Uint8Array(4), 272));
    expect(canvas.height).toBe(0); // untouched
    unmount();
    expect(fake.frameSubscriberCount).toBe(0);
  });

  it("no-ops when the ref is empty", () => {
    const fake = new FakeSession();
    const ref = { current: null };
    renderHook(() => useAvMirrorCanvas(ref, asSession(fake)));
    expect(() => act(() => fake.emitFrame(new Uint8Array(4), 272))).not.toThrow();
  });
});
