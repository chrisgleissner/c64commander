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

/** Only the fields this component reads; `fps`/`standard` drive the frame-rate readout. */
type MirrorVideoState = { videoLive: boolean; video: { state: string; fps?: number; standard?: string } };

type MirrorLockState = {
  state: string;
  subject: { x: number; y: number; w: number; h: number } | null;
  confidence: number;
};

const mirror = vi.hoisted(() => ({
  video: { videoLive: true, video: { state: "live" } } as MirrorVideoState,
  viewport: { scale: 2, cx: 0.5, cy: 0.5 },
  lock: { state: "idle", subject: null, confidence: 0 } as MirrorLockState,
  ops: {
    zoomBy: vi.fn(),
    panBy: vi.fn(),
    centerOn: vi.fn(),
    setScale: vi.fn(),
    reset: vi.fn(),
    lockOn: vi.fn(),
    releaseLock: vi.fn(),
  },
}));

vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => mirror.video,
  useAvMirrorCanvas: vi.fn(),
}));

vi.mock("@/hooks/useMirrorViewport", () => ({
  useMirrorViewport: () => ({ viewport: mirror.viewport, lock: mirror.lock, ...mirror.ops }),
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

/**
 * Follow-focus: the long press that locks the view on to one object, the marker that says which
 * object it picked, and the two ways back out. The gesture shares a pointer stream with drag-to-pan
 * and pinch-to-zoom, so most of what is asserted here is what must NOT happen.
 */
describe("AvMirrorImmersive — locking on to an object", () => {
  beforeEach(() => {
    Object.values(mirror.ops).forEach((fn) => fn.mockReset());
    mirror.video = { videoLive: true, video: { state: "live" } };
    mirror.viewport = { scale: 2, cx: 0.5, cy: 0.5 };
    mirror.lock = { state: "idle", subject: null, confidence: 0 };
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  const holdAt = (stage: HTMLElement, x: number, y: number, ms = 600) => {
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: x, clientY: y });
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  it("locks on to the point held, in frame coordinates", () => {
    vi.useFakeTimers();
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));
    const stage = stubStage();

    holdAt(stage, 192, 136);

    // The stage is the whole 384x272 frame and the viewport is 2x centred, so its middle is the
    // middle of the frame.
    expect(mirror.ops.lockOn).toHaveBeenCalledWith(0.5, 0.5);
  });

  it("does nothing on a long press while the view is not following", () => {
    vi.useFakeTimers();
    render(<AvMirrorImmersive />);
    holdAt(stubStage(), 192, 136);
    expect(mirror.ops.lockOn).not.toHaveBeenCalled();
  });

  it("does not fire when the finger drags, so panning still pans", () => {
    vi.useFakeTimers();
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));
    const stage = stubStage();

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mirror.ops.panBy).toHaveBeenCalled();
    expect(mirror.ops.lockOn).not.toHaveBeenCalled();
  });

  it("does not fire when a second finger arrives, so pinching still zooms", () => {
    vi.useFakeTimers();
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));
    const stage = stubStage();

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 200, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 260, clientY: 100 });

    expect(mirror.ops.zoomBy).toHaveBeenCalled();
    expect(mirror.ops.lockOn).not.toHaveBeenCalled();
  });

  it("does not fire when the finger lifts before the hold is complete", () => {
    vi.useFakeTimers();
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));
    const stage = stubStage();

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mirror.ops.lockOn).not.toHaveBeenCalled();
  });

  it("tells the user how to lock on while following with nothing locked", () => {
    render(<AvMirrorImmersive />);
    expect(screen.queryByTestId("av-immersive-lock-hint")).toBeNull();
    fireEvent.click(screen.getByTestId("av-immersive-follow"));
    expect(screen.getByTestId("av-immersive-lock-hint")).toHaveTextContent("Hold on your character");
  });

  it("marks what it is following, and reports the same state on the root", () => {
    mirror.lock = { state: "locked", subject: { x: 0.5, y: 0.5, w: 0.05, h: 0.07 }, confidence: 0.9 };
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));

    const reticle = screen.getByTestId("av-immersive-lock-reticle");
    expect(reticle).toHaveAttribute("data-lock-state", "locked");
    expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-lock-state", "locked");
    // The hint has done its job and is out of the way.
    expect(screen.queryByTestId("av-immersive-lock-hint")).toBeNull();
  });

  it("reads the same while coasting, because only the certainty changed", () => {
    mirror.lock = { state: "coasting", subject: { x: 0.5, y: 0.5, w: 0.05, h: 0.07 }, confidence: 0.3 };
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));
    expect(screen.getByTestId("av-immersive-lock-status")).toHaveTextContent("Locked on");
    expect(screen.getByTestId("av-immersive-lock-status")).toHaveAttribute("data-lock-state", "coasting");
  });

  it("hides the marker when the user has turned it off in Settings", () => {
    localStorage.setItem("c64u_follow_reticle", "0");
    mirror.lock = { state: "locked", subject: { x: 0.5, y: 0.5, w: 0.05, h: 0.07 }, confidence: 0.9 };
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));

    expect(screen.queryByTestId("av-immersive-lock-reticle")).toBeNull();
    // The chip stays: the marker is decoration, the chip is the state and the way out of it.
    expect(screen.getByTestId("av-immersive-lock-status")).toBeInTheDocument();
  });

  it("gives the lock up when the chip that reports it is tapped", () => {
    mirror.lock = { state: "locked", subject: { x: 0.5, y: 0.5, w: 0.05, h: 0.07 }, confidence: 0.9 };
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-follow"));
    fireEvent.click(screen.getByTestId("av-immersive-lock-status"));
    expect(mirror.ops.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("locks on to the middle of the view for a handset with no touchscreen", () => {
    const ref = createRef<AvMirrorImmersiveHandle>();
    mirror.viewport = { scale: 4, cx: 0.3, cy: 0.7 };
    render(<AvMirrorImmersive ref={ref} />);
    // Turns following on as it goes, so the keypad user has one key to know about, not two.
    act(() => ref.current?.toggleLock());
    expect(mirror.ops.lockOn).toHaveBeenCalledWith(0.3, 0.7);
    expect(screen.getByTestId("av-immersive-follow")).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the lock go again on the same key, so the way out needs no touchscreen either", () => {
    const ref = createRef<AvMirrorImmersiveHandle>();
    mirror.lock = { state: "locked", subject: { x: 0.5, y: 0.5, w: 0.05, h: 0.07 }, confidence: 0.9 };
    render(<AvMirrorImmersive ref={ref} />);
    act(() => ref.current?.toggleLock());
    expect(mirror.ops.releaseLock).toHaveBeenCalledTimes(1);
    expect(mirror.ops.lockOn).not.toHaveBeenCalled();
  });

  it("shows an aim in the middle of the picture while adjusting with nothing locked", () => {
    render(<AvMirrorImmersive />);
    expect(screen.queryByTestId("av-immersive-lock-aim")).toBeNull();
    fireEvent.click(screen.getByTestId("av-immersive-mode-toggle"));
    expect(screen.getByTestId("av-immersive-lock-aim")).toBeInTheDocument();
    expect(screen.getByTestId("av-immersive-lock-hint")).toHaveTextContent("Line it up, press OK");
  });

  it("drops the aim once something is locked, because the marker says it better", () => {
    mirror.lock = { state: "locked", subject: { x: 0.5, y: 0.5, w: 0.05, h: 0.07 }, confidence: 0.9 };
    render(<AvMirrorImmersive />);
    fireEvent.click(screen.getByTestId("av-immersive-mode-toggle"));
    expect(screen.queryByTestId("av-immersive-lock-aim")).toBeNull();
    expect(screen.getByTestId("av-immersive-lock-reticle")).toBeInTheDocument();
  });
});

describe("AvMirrorImmersive", () => {
  beforeEach(() => {
    Object.values(mirror.ops).forEach((fn) => fn.mockReset());
    mirror.video = { videoLive: true, video: { state: "live" } };
    mirror.viewport = { scale: 2, cx: 0.5, cy: 0.5 };
    mirror.lock = { state: "idle", subject: null, confidence: 0 };
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  // The chip has to fit a status row that also carries the video standard and frame
  // rate on a 320px-wide screen, so its face is one word. The sentence a screen reader
  // needs is the accessible name, which is asserted separately here — a text-content
  // assertion alone would pass whether or not the visible face was shortened.
  it("shows the driving mode chip and the control cluster while live", () => {
    render(<AvMirrorImmersive />);
    expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-mode", "drive");
    const chip = screen.getByTestId("av-mirror-mode-chip");
    expect(chip).toHaveTextContent("C64");
    expect(chip.textContent).not.toContain("Driving");
    expect(chip).toHaveAttribute("aria-label", "Driving C64");
    expect(screen.getByTestId("av-mirror-immersive-controls")).toBeInTheDocument();
  });

  it("keeps the mode chip and the frame-rate readout on one status row", () => {
    mirror.video = { videoLive: true, video: { state: "live", fps: 50, standard: "PAL" } };
    render(<AvMirrorImmersive />);
    const chip = screen.getByTestId("av-mirror-mode-chip");
    const fps = screen.getByTestId("av-mirror-immersive-fps");
    expect(fps).toHaveTextContent("PAL 50 fps");
    // One row, in reading order: it reads "C64 … PAL 50 fps". Asserted against the row itself
    // rather than against a shared parent element, because the two status chips on the left are
    // grouped together and a grouping change is not a layout change.
    const row = screen.getByTestId("av-mirror-status-row");
    expect(row).toContainElement(chip);
    expect(row).toContainElement(fps);
    expect(chip.compareDocumentPosition(fps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    const modeToggle = screen.getByTestId("av-immersive-mode-toggle");
    expect(modeToggle).toHaveTextContent("Fit");
    fireEvent.click(modeToggle);
    expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-mode", "adjust");
    const chip = screen.getByTestId("av-mirror-mode-chip");
    expect(chip).toHaveTextContent("View");
    expect(chip.textContent).not.toContain("Adjusting");
    expect(chip).toHaveAttribute("aria-label", "Adjusting view");
    expect(screen.getByTestId("av-immersive-mode-toggle")).toHaveTextContent("Done");
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

  describe("rotation", () => {
    it("reports the rotation it was given and turns the stage back by it", () => {
      const { rerender } = render(<AvMirrorImmersive />);
      expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-rotation", "0");

      rerender(<AvMirrorImmersive rotation={90} />);
      expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-rotation", "90");
      expect(screen.getByTestId("av-mirror-immersive-stage")).toHaveStyle({
        transform: "translate(-50%, -50%) rotate(-90deg)",
      });
    });

    it("leaves the chrome unrotated, because a player reading it is looking at the phone", () => {
      render(<AvMirrorImmersive rotation={90} />);
      expect(screen.getByTestId("av-mirror-mode-chip").closest("div")).not.toHaveStyle({
        transform: "translate(-50%, -50%) rotate(-90deg)",
      });
      expect(screen.getByTestId("av-mirror-immersive-controls").getAttribute("style")).toBeNull();
    });

    it("swaps the frame aspect at a quarter turn so a turned picture gains width", () => {
      const measuredBox = () => screen.getByTestId("av-mirror-immersive-stage").parentElement!;
      const { rerender } = render(<AvMirrorImmersive />);
      expect(measuredBox()).toHaveStyle({ aspectRatio: "384 / 272" });
      rerender(<AvMirrorImmersive rotation={270} />);
      expect(measuredBox()).toHaveStyle({ aspectRatio: "272 / 384" });
    });

    it("takes every pixel it is given when told to fill, rather than sizing to the aspect", () => {
      render(<AvMirrorImmersive fill />);
      const root = screen.getByTestId("av-mirror-immersive");
      const measuredBox = screen.getByTestId("av-mirror-immersive-stage").parentElement!;
      expect(root.className).toContain("flex-1");
      expect(measuredBox.getAttribute("style")).toBeNull();
      expect(measuredBox.className).toContain("absolute");
    });

    // GM-12: the argument handed to panBy is the assertion, not a pixel — a drag
    // along the axis the player sees must pan the picture along the axis it belongs to.
    it("pans along the axis the player sees at 90°", () => {
      render(<AvMirrorImmersive rotation={90} />);
      const stage = stubStage();
      // Drag rightward across the player's view.
      fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 100 });

      const [dx, dy] = mirror.ops.panBy.mock.calls[0];
      // R(90) sends (+40, 0) to (0, +40): the picture's own y axis, not its x.
      expect(dx).toBeCloseTo(0, 10);
      expect(dy).toBeLessThan(0);
    });

    it("pans along the opposite axis at 270°", () => {
      render(<AvMirrorImmersive rotation={270} />);
      const stage = stubStage();
      fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 100 });

      const [dx, dy] = mirror.ops.panBy.mock.calls[0];
      expect(dx).toBeCloseTo(0, 10);
      expect(dy).toBeGreaterThan(0);
    });

    /**
     * The keys reach the same viewport the drag does, so they have to agree about which way
     * "right" points once the handset is turned. `panStep` is given the direction the key has in
     * PORTRAIT, and the portrait-right key points DOWN once the handset is turned 90° clockwise —
     * the same permutation the joystick applies to that key.
     */
    it("pans the keys along the axis the player sees at 90°", () => {
      const ref = createRef<AvMirrorImmersiveHandle>();
      render(<AvMirrorImmersive ref={ref} rotation={90} />);

      act(() => ref.current!.panStep(1, 0));
      const [dx, dy] = mirror.ops.panBy.mock.calls[0];
      expect(dx).toBeCloseTo(0, 10);
      expect(dy).toBeGreaterThan(0);
    });

    it("pans the keys the other way at 270°", () => {
      const ref = createRef<AvMirrorImmersiveHandle>();
      render(<AvMirrorImmersive ref={ref} rotation={270} />);

      act(() => ref.current!.panStep(1, 0));
      const [dx, dy] = mirror.ops.panBy.mock.calls[0];
      expect(dx).toBeCloseTo(0, 10);
      expect(dy).toBeLessThan(0);
    });

    it("leaves the keys alone at 0°, where every frame is the same frame", () => {
      const ref = createRef<AvMirrorImmersiveHandle>();
      render(<AvMirrorImmersive ref={ref} rotation={0} />);

      act(() => ref.current!.panStep(1, 0));
      const [dx, dy] = mirror.ops.panBy.mock.calls[0];
      expect(dx).toBeGreaterThan(0);
      expect(dy).toBeCloseTo(0, 10);
    });

    it("keeps the pinch focal point in the picture's own frame at 90°", () => {
      render(<AvMirrorImmersive rotation={90} />);
      const stage = stubStage();
      fireEvent.pointerDown(stage, { pointerId: 1, clientX: 150, clientY: 136 });
      fireEvent.pointerDown(stage, { pointerId: 2, clientX: 250, clientY: 136 });
      fireEvent.pointerMove(stage, { pointerId: 2, clientX: 350, clientY: 136 });

      const [factor, focal] = mirror.ops.zoomBy.mock.calls[0];
      expect(factor).toBe(2);
      // The midpoint sits right of the stage centre and on its horizontal centre
      // line. At 90° that offset belongs to the picture's OWN y axis, so the focal
      // point stays on the picture's vertical centre line and moves down it.
      expect(focal.x).toBeCloseTo(0.5, 10);
      expect(focal.y).toBeGreaterThan(0.5);
    });
  });
});
