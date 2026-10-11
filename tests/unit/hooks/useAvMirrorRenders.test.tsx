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

const snapshotWith = (video: Partial<AvMirrorSnapshot["video"]>, audio: Partial<AvMirrorSnapshot["audio"]> = {}) =>
  ({
    audio: { state: "live", droppedPackets: 0, error: null, ...audio },
    video: { state: "live", fps: 50, error: null, presented: 0, droppedPackets: 0, ...video },
  }) as unknown as AvMirrorSnapshot;

class FakeSession {
  snapshot = snapshotWith({});
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
    this.listeners.forEach((listener) => listener(snapshot));
  }
  emitFrame(frame: Uint8Array, height: number) {
    this.frameListeners.forEach((handler) => handler(frame, height));
  }
}

const asSession = (fake: FakeSession) => fake as unknown as AvMirrorSession;

describe("useAvMirror re-renders", () => {
  it("does not re-render a surface for counters it never shows", () => {
    const fake = new FakeSession();
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useAvMirror(asSession(fake));
    });
    const before = renders;
    act(() => fake.push(snapshotWith({ presented: 120, droppedPackets: 3 }, { droppedPackets: 4 })));
    act(() => fake.push(snapshotWith({ fps: 49, presented: 130 })));
    expect(renders).toBe(before);
  });

  it("re-renders a surface when a shown field changes", () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvMirror(asSession(fake)));
    act(() => fake.push(snapshotWith({ state: "error", error: "Lost the video stream connection." })));
    expect(result.current.video.state).toBe("error");
    expect(result.current.video.error).toBe("Lost the video stream connection.");
  });

  it("re-renders a frame-rate badge as the rate moves", () => {
    const fake = new FakeSession();
    const { result } = renderHook(() => useAvMirror(asSession(fake), { frameRate: true }));
    act(() => fake.push(snapshotWith({ fps: 49 })));
    expect(result.current.video.fps).toBe(49);
    act(() => fake.push(snapshotWith({ fps: 49, standard: "NTSC" } as Partial<AvMirrorSnapshot["video"]>)));
    expect((result.current.video as { standard?: string }).standard).toBe("NTSC");
  });
});

describe("useAvMirrorCanvas painting", () => {
  const makeStubCanvas = () => {
    const putImageData = vi.fn();
    const createImageData = vi.fn((w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }));
    const canvas = Object.assign(new EventTarget(), {
      height: 0,
      getContext: vi.fn(() => ({ createImageData, putImageData })),
    }) as unknown as HTMLCanvasElement;
    return { canvas, putImageData };
  };

  it("copies nothing to the canvas for a frame that did not change", () => {
    const fake = new FakeSession();
    const { canvas, putImageData } = makeStubCanvas();
    renderHook(() => useAvMirrorCanvas({ current: canvas }, asSession(fake)));
    const frame = new Uint8Array(384 * 136);
    act(() => fake.emitFrame(frame, 272));
    act(() => fake.emitFrame(frame, 272));
    act(() => fake.emitFrame(frame.slice(), 272));
    expect(putImageData).toHaveBeenCalledTimes(1);
  });

  it("copies only the changed lines to the canvas", () => {
    const fake = new FakeSession();
    const { canvas, putImageData } = makeStubCanvas();
    renderHook(() => useAvMirrorCanvas({ current: canvas }, asSession(fake)));
    act(() => fake.emitFrame(new Uint8Array(384 * 136), 272));
    const next = new Uint8Array(384 * 136);
    next.fill(0x11, 20 * 192, 22 * 192);
    act(() => fake.emitFrame(next, 272));
    expect(putImageData).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 0, 20, 384, 2);
  });

  it.each([
    ["its 2D context is restored", (canvas: HTMLCanvasElement) => canvas.dispatchEvent(new Event("contextrestored"))],
    ["the app is shown again", () => document.dispatchEvent(new Event("visibilitychange"))],
  ])("repaints the whole picture of a still screen once %s", (_, discardCanvas) => {
    const fake = new FakeSession();
    const { canvas, putImageData } = makeStubCanvas();
    renderHook(() => useAvMirrorCanvas({ current: canvas }, asSession(fake)));
    const frame = new Uint8Array(384 * 136);
    act(() => fake.emitFrame(frame, 272));
    act(() => discardCanvas(canvas));
    act(() => fake.emitFrame(frame, 272));
    expect(putImageData).toHaveBeenCalledTimes(2);
    expect(putImageData).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 0, 0, 384, 272);
  });

  it("repaints the whole picture onto a canvas it has not drawn on", () => {
    const fake = new FakeSession();
    const first = makeStubCanvas();
    const ref = { current: first.canvas };
    renderHook(() => useAvMirrorCanvas(ref, asSession(fake)));
    const frame = new Uint8Array(384 * 136);
    act(() => fake.emitFrame(frame, 272));
    const second = makeStubCanvas();
    ref.current = second.canvas;
    act(() => fake.emitFrame(frame, 272));
    expect(second.putImageData).toHaveBeenCalledWith(expect.anything(), 0, 0, 0, 0, 384, 272);
  });
});
