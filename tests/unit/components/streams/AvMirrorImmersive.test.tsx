/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvMirrorImmersive, type AvMirrorImmersiveHandle } from "@/components/streams/AvMirrorImmersive";

const mirror = vi.hoisted(() => ({
  video: { videoLive: true, video: { state: "live" } },
  viewport: { scale: 2, cx: 0.5, cy: 0.5 },
  ops: {
    zoomBy: vi.fn(),
    panBy: vi.fn(),
    centerOn: vi.fn(),
    setScale: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => mirror.video,
  useAvMirrorCanvas: vi.fn(),
}));

vi.mock("@/hooks/useMirrorViewport", () => ({
  useMirrorViewport: () => ({ viewport: mirror.viewport, ...mirror.ops }),
}));

vi.mock("@/components/streams/AvMirrorMinimap", () => ({
  AvMirrorMinimap: ({ onSeek }: { onSeek: (x: number, y: number) => void }) => (
    <button data-testid="minimap-stub" onClick={() => onSeek(0.9, 0.1)} />
  ),
}));

const stubStage = () => {
  const stage = screen.getByTestId("av-mirror-immersive-stage");
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 384, bottom: 272, width: 384, height: 272, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return stage;
};

describe("AvMirrorImmersive", () => {
  beforeEach(() => {
    Object.values(mirror.ops).forEach((fn) => fn.mockReset());
    mirror.video = { videoLive: true, video: { state: "live" } };
    mirror.viewport = { scale: 2, cx: 0.5, cy: 0.5 };
  });
  afterEach(() => vi.useRealTimers());

  it("shows the Driving-C64 mode chip and the control cluster while live", () => {
    render(<AvMirrorImmersive />);
    expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-mode", "drive");
    expect(screen.getByTestId("av-mirror-mode-chip")).toHaveTextContent("Driving C64");
    expect(screen.getByTestId("av-mirror-immersive-controls")).toBeInTheDocument();
  });

  it("shows a 'Not watching' overlay and no controls when video is off", () => {
    mirror.video = { videoLive: false, video: { state: "off" } };
    render(<AvMirrorImmersive />);
    expect(screen.getByText("Not watching")).toBeInTheDocument();
    expect(screen.queryByTestId("av-mirror-immersive-controls")).toBeNull();
  });

  it("maps the not-live overlay to connecting and error states", () => {
    mirror.video = { videoLive: false, video: { state: "connecting" } };
    const { rerender } = render(<AvMirrorImmersive />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    mirror.video = { videoLive: false, video: { state: "error" } };
    rerender(<AvMirrorImmersive />);
    expect(screen.getByText("Video unavailable")).toBeInTheDocument();
  });

  it("wires the on-screen zoom/fit/follow/adjust controls", () => {
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-zoom-in"));
    fireEvent.click(screen.getByTestId("av-immersive-zoom-out"));
    fireEvent.click(screen.getByTestId("av-immersive-fit"));
    expect(mirror.ops.zoomBy).toHaveBeenCalledWith(1.5);
    expect(mirror.ops.zoomBy).toHaveBeenCalledWith(1 / 1.5);
    expect(mirror.ops.reset).toHaveBeenCalledTimes(1);

    const follow = screen.getByTestId("av-immersive-follow");
    expect(follow).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(follow);
    expect(screen.getByTestId("av-immersive-follow")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("av-immersive-mode-toggle"));
    expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-mode", "adjust");
    expect(screen.getByTestId("av-mirror-mode-chip")).toHaveTextContent("Adjusting view");
  });

  it("exposes an imperative handle for physical-key control", () => {
    const ref = createRef<AvMirrorImmersiveHandle>();
    const onModeChange = vi.fn();
    render(<AvMirrorImmersive ref={ref} onModeChange={onModeChange} />);

    act(() => ref.current!.zoomIn());
    expect(mirror.ops.zoomBy).toHaveBeenCalledWith(1.5);
    act(() => ref.current!.zoomOut());
    expect(mirror.ops.zoomBy).toHaveBeenCalledWith(1 / 1.5);
    act(() => ref.current!.reset());
    expect(mirror.ops.reset).toHaveBeenCalled();

    // panStep is scale-aware: step 0.35 / scale(2) = 0.175
    act(() => ref.current!.panStep(1, 0));
    expect(mirror.ops.panBy).toHaveBeenCalledWith(0.175, 0);

    expect(ref.current!.getMode()).toBe("drive");
    act(() => ref.current!.toggleMode());
    expect(ref.current!.getMode()).toBe("adjust");
    expect(onModeChange).toHaveBeenLastCalledWith("adjust");
  });

  it("pans on a single-finger drag over the picture", () => {
    render(<AvMirrorImmersive />);
    const stage = stubStage();
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 60 });
    expect(mirror.ops.panBy).toHaveBeenCalledTimes(1);
    const [dx, dy] = mirror.ops.panBy.mock.calls[0];
    expect(dx).toBeLessThan(0); // dragging right pans the content left
    expect(dy).toBeGreaterThan(0);
  });

  it("double-tap zooms toward the point when fit, and resets when already zoomed", () => {
    mirror.viewport = { scale: 1, cx: 0.5, cy: 0.5 };
    const { rerender } = render(<AvMirrorImmersive />);
    let stage = stubStage();
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 200, clientY: 140 });
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 200, clientY: 140 });
    expect(mirror.ops.zoomBy).toHaveBeenCalledWith(3, expect.objectContaining({ x: expect.any(Number) }));

    mirror.ops.zoomBy.mockReset();
    mirror.viewport = { scale: 3, cx: 0.5, cy: 0.5 };
    rerender(<AvMirrorImmersive />);
    stage = stubStage();
    fireEvent.pointerUp(stage, { pointerId: 1 }); // release the first tap's pointer
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 10, clientY: 10 });
    expect(mirror.ops.reset).toHaveBeenCalled();
    expect(mirror.ops.zoomBy).not.toHaveBeenCalled();
  });

  it("pinch-zooms with two pointers", () => {
    render(<AvMirrorImmersive />);
    const stage = stubStage();
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 150, clientY: 136 });
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 250, clientY: 136 }); // initial dist 100
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 350, clientY: 136 }); // dist 200 → factor 2
    expect(mirror.ops.zoomBy).toHaveBeenCalledWith(2, expect.objectContaining({ x: expect.any(Number) }));
    fireEvent.pointerUp(stage, { pointerId: 2 });
    fireEvent.pointerUp(stage, { pointerId: 1 });
  });

  it("repositions via the minimap seek callback once zoomed", () => {
    render(<AvMirrorImmersive />);
    expect(screen.getByTestId("minimap-stub")).toBeInTheDocument(); // scale 2 > 1.05
    fireEvent.click(screen.getByTestId("minimap-stub"));
    expect(mirror.ops.centerOn).toHaveBeenCalledWith(0.9, 0.1);
  });

  it("auto-reverts Adjust → Drive after the idle timeout", () => {
    vi.useFakeTimers();
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-mode-toggle"));
    expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-mode", "adjust");
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-mode", "drive");
  });
});
