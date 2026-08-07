/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Crosshair, Gamepad2, Maximize, Minus, Plus, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAvMirror, useAvMirrorCanvas } from "@/hooks/useAvMirror";
import { useMirrorViewport } from "@/hooks/useMirrorViewport";
import { viewportRect } from "@/lib/streams/mirrorViewport";
import { fitStageSize, unrotateDelta, unrotatePoint } from "@/lib/remoteInput/deviceRotation";
import type { DeviceRotation } from "@/lib/remoteInput/joystickKeyBindings";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { addLog } from "@/lib/logging";
import { AvMirrorMinimap } from "./AvMirrorMinimap";

/** view-lock modes: physical input either drives the C64 or adjusts the mirror view. */
export type MirrorInputMode = "drive" | "adjust";

export interface AvMirrorImmersiveHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Pan by a step; dx/dy in [-1,1] are fractions of the VISIBLE region (scale-aware). */
  panStep: (dx: number, dy: number) => void;
  toggleMode: () => void;
  getMode: () => MirrorInputMode;
}

const KEY_PAN_STEP = 0.35; // fraction of the visible region per key press

export interface AvMirrorImmersiveProps {
  session?: AvMirrorSession;
  onModeChange?: (mode: MirrorInputMode) => void;
  /** How far the app's frame appears turned to the player; the picture is turned back by this. */
  rotation?: DeviceRotation;
  /** Take all the height available instead of sizing to the frame's aspect. */
  fill?: boolean;
  className?: string;
}

const DOUBLE_TAP_MS = 300;
export const CONTROLS_HIDE_MS = 2600;
const ZOOM_STEP = 1.5;
const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 272;
const FRAME_ASPECT = FRAME_WIDTH / FRAME_HEIGHT;

const haptic = () => {
  try {
    (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(12);
  } catch (error) {
    addLog("debug", "A/V mirror: haptic feedback unavailable (ignored)", {
      error: (error as Error)?.message ?? String(error),
    });
  }
};

/**
 * The maximised, controllable screen mirror for Remote Input game mode. Native-res
 * decode is GPU-scaled, so zoom is fixed-cost. The one hard rule (06-av-mirror-ux
 * §7.1): physical input is NEVER ambiguous — a colour-coded view-lock mode
 * (blue "C64" = driving the machine, amber "View" = adjusting the view) makes the
 * current role unmistakable. It is flippable by an on-screen button and by a physical
 * key (via the ref), and it auto-reverts to Drive after idle. Touch on the picture
 * always adjusts; the joystick / keyboard controls always relay.
 *
 * Only the picture turns with the handset. The zoom cluster, the minimap and the
 * mode chip stay anchored to the app frame — they are app chrome, and a player
 * using them is looking at the phone rather than at the game.
 */
export const AvMirrorImmersive = forwardRef<AvMirrorImmersiveHandle, AvMirrorImmersiveProps>(function AvMirrorImmersive(
  { session, onModeChange, rotation = 0, fill = false, className },
  ref,
) {
  const { videoLive, video } = useAvMirror(session);
  const [follow, setFollow] = useState(false);
  const { viewport, zoomBy, panBy, centerOn, reset } = useMirrorViewport({ session, follow });
  const [mode, setModeState] = useState<MirrorInputMode>("drive");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useAvMirrorCanvas(canvasRef, session);

  const viewportStateRef = useRef(viewport);
  viewportStateRef.current = viewport;

  const quarterTurned = rotation === 90 || rotation === 270;

  // The picture uses the whole space it is given, so the drawn size has to be
  // measured rather than declared: at 90° and 270° the aspect that fits is the
  // reciprocal one, which is exactly what lets a turned picture claim the width.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const next = fitStageSize(bounds.width, bounds.height, FRAME_ASPECT, rotation);
      setStageSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rotation]);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Hold onModeChange in a ref: consumers (RemoteInputSheet) pass an inline arrow, so depending on
  // it here would rebuild setMode → bumpIdle every render and reset the idle timer forever (it
  // would never fire). Keeping setMode STABLE lets the idle-timer effect re-run only on mode change.
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  const setMode = useCallback((next: MirrorInputMode) => {
    setModeState((prev) => {
      if (prev !== next) haptic();
      return next;
    });
    onModeChangeRef.current?.(next);
  }, []);
  const toggleMode = useCallback(() => setMode(modeRef.current === "drive" ? "adjust" : "drive"), [setMode]);

  // Auto-revert Adjust → Drive after idle, so a user can never be stranded in view mode.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpIdle = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (modeRef.current === "adjust") setMode("drive");
      else setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, [setMode]);
  useEffect(() => {
    bumpIdle();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [bumpIdle, mode]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        bumpIdle();
        zoomBy(ZOOM_STEP);
      },
      zoomOut: () => {
        bumpIdle();
        zoomBy(1 / ZOOM_STEP);
      },
      reset: () => {
        bumpIdle();
        reset();
      },
      /**
       * `dx`/`dy` are the direction the key points in PORTRAIT, which is how the key handler
       * names them. Mapping them through the same rotation the drag path uses answers both
       * questions the turned handset raises at once: the portrait-right key points down once
       * the handset is turned 90° clockwise, and the picture the player is looking at is the
       * stage's own upright frame — and `unrotateDelta` of the portrait direction is exactly
       * that composition.
       *
       * Without it the drag path panned along the axis the player saw and the KEYS panned
       * along the untouched one, so the same adjustment done two ways went two different
       * directions — and only the drag had a test above 0°.
       */
      panStep: (dx, dy) => {
        bumpIdle();
        const scale = viewportStateRef.current.scale;
        const local = unrotateDelta(dx, dy, rotation);
        panBy((local.x * KEY_PAN_STEP) / scale, (local.y * KEY_PAN_STEP) / scale);
      },
      toggleMode,
      getMode: () => modeRef.current,
    }),
    [zoomBy, panBy, reset, toggleMode, bumpIdle, rotation],
  );

  // --- Touch gestures on the picture (always view-control, per §7.1) ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number } | null>(null);
  const lastTapRef = useRef(0);

  /**
   * The stage in its OWN frame: the centre a rotation turns about, and the width
   * and height before that rotation. The element's bounding rect is its rotated
   * bounding box, so at a quarter turn its two sides are the ones that swap.
   */
  const stageFrame = () => {
    const element = stageRef.current;
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      centre: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
      width: quarterTurned ? bounds.height : bounds.width,
      height: quarterTurned ? bounds.width : bounds.height,
    };
  };

  type StageFrame = NonNullable<ReturnType<typeof stageFrame>>;

  const focalFromPoint = (clientX: number, clientY: number, frame: StageFrame) => {
    const local = unrotatePoint(clientX, clientY, frame.centre, rotation);
    const rect = viewportRect(viewport);
    return {
      x: rect.x + (0.5 + local.x / frame.width) * rect.w,
      y: rect.y + (0.5 + local.y / frame.height) * rect.h,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    bumpIdle();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    } else if (pointers.current.size === 1) {
      const now = Date.now();
      const frame = stageFrame();
      if (now - lastTapRef.current < DOUBLE_TAP_MS && frame) {
        // double-tap: zoom toward the point, or reset when already zoomed in
        if (viewport.scale > 1.05) reset();
        else zoomBy(3, focalFromPoint(event.clientX, event.clientY, frame));
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(event.pointerId);
    if (!prev) return;
    const frame = stageFrame();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!frame) return;

    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.dist > 0) {
        const factor = dist / pinchRef.current.dist;
        zoomBy(factor, focalFromPoint((a.x + b.x) / 2, (a.y + b.y) / 2, frame));
      }
      pinchRef.current.dist = dist;
    } else if (pointers.current.size === 1) {
      // Turn the drag into the picture's own frame first, or a drag along the axis
      // the player sees pans along the picture's other axis — a defect that only
      // appears once the handset is turned.
      const local = unrotateDelta(event.clientX - prev.x, event.clientY - prev.y, rotation);
      const dx = -(local.x / frame.width) / viewport.scale;
      const dy = -(local.y / frame.height) / viewport.scale;
      if (dx !== 0 || dy !== 0) panBy(dx, dy);
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
  };

  const adjust = mode === "adjust";
  const transform = `translate(${((0.5 - viewport.scale * viewport.cx) * 100).toFixed(3)}%, ${(
    (0.5 - viewport.scale * viewport.cy) *
    100
  ).toFixed(3)}%) scale(${viewport.scale.toFixed(3)})`;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border-2 bg-black transition-colors",
        // shrink-0 keeps the measured height inside the Remote Input flex column, which
        // would otherwise collapse the mirror to its borders. Filling instead gives the
        // picture every pixel the sheet body is not using.
        fill ? "min-h-0 flex-1" : "shrink-0",
        adjust ? "border-amber-400" : "border-primary",
        className,
      )}
      data-testid="av-mirror-immersive"
      data-mode={mode}
      data-rotation={rotation}
    >
      {/* The measured box. In flow with the frame's aspect when the mirror sizes itself,
          so the root has a real height for the controls below it to stack against;
          absolutely filling the root when the mirror is told to take what is left. */}
      <div
        ref={containerRef}
        className={fill ? "absolute inset-0" : "relative w-full"}
        style={fill ? undefined : { aspectRatio: quarterTurned ? "272 / 384" : "384 / 272" }}
      >
        {/* The status row along the top of the picture: which input mode is in effect on
            the left, the video standard and frame rate on the right. One row rather than
            two independently anchored badges, so on a 320px-wide screen the two read as a
            single line of status and cannot collide.

            The mode item is the glanceable "who owns input" signal. Its face is one word —
            "C64" or "View" — because the row has to fit beside the frame-rate readout; the
            full sentence stays as the accessible name, and the colour and the icon carry
            the same distinction visually. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow",
              adjust ? "bg-amber-500" : "bg-primary",
            )}
            role="status"
            aria-label={adjust ? "Adjusting view" : "Driving C64"}
            data-testid="av-mirror-mode-chip"
          >
            {adjust ? <ScanEye className="h-3 w-3" /> : <Gamepad2 className="h-3 w-3" />}
            {adjust ? "View" : "C64"}
          </span>
          {videoLive && video.fps > 0 && (
            <span
              className="rounded bg-black/60 px-1.5 py-0.5 text-xs leading-tight text-white/80"
              data-testid="av-mirror-immersive-fps"
            >
              {video.standard ?? "PAL"} {video.fps} fps
            </span>
          )}
        </div>

        <div
          ref={stageRef}
          className="absolute left-1/2 top-1/2 touch-none select-none"
          style={{
            width: stageSize.width || undefined,
            height: stageSize.height || undefined,
            transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          data-testid="av-mirror-immersive-stage"
        >
          <canvas
            ref={canvasRef}
            width={FRAME_WIDTH}
            height={FRAME_HEIGHT}
            className="block h-full w-full origin-top-left will-change-transform"
            style={{ imageRendering: "pixelated", transform }}
            data-testid="av-mirror-immersive-canvas"
          />
        </div>
      </div>

      {!videoLive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white/70">
          {video.state === "connecting"
            ? "Connecting…"
            : video.state === "error"
              ? "Video unavailable"
              : "Not watching"}
        </div>
      )}
      {/* Minimap — only meaningful once zoomed in. */}
      {videoLive && viewport.scale > 1.05 && (
        <div className="absolute bottom-2 left-2 z-10">
          <AvMirrorMinimap viewport={viewport} onSeek={(cx, cy) => centerOn(cx, cy)} session={session} />
        </div>
      )}

      {/* Auto-hiding control cluster. */}
      {videoLive && (controlsVisible || adjust) && (
        <div
          className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-full bg-black/55 p-1 backdrop-blur"
          data-testid="av-mirror-immersive-controls"
        >
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-white hover:bg-white/15"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            data-testid="av-immersive-zoom-out"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-white hover:bg-white/15"
            aria-label="Zoom in"
            onClick={() => zoomBy(ZOOM_STEP)}
            data-testid="av-immersive-zoom-in"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-white hover:bg-white/15"
            aria-label="Fit to screen"
            onClick={reset}
            data-testid="av-immersive-fit"
          >
            <Maximize className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant={follow ? "default" : "ghost"}
            className={cn("h-8 w-8", follow ? "" : "text-white hover:bg-white/15")}
            aria-label="Follow activity"
            aria-pressed={follow}
            onClick={() => setFollow((value) => !value)}
            data-testid="av-immersive-follow"
          >
            <Crosshair className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant={adjust ? "default" : "secondary"}
            className="h-8"
            aria-pressed={adjust}
            aria-label={adjust ? "Done adjusting the view" : "Fit and pan the view"}
            onClick={toggleMode}
            data-testid="av-immersive-mode-toggle"
          >
            {adjust ? "Done" : "Fit"}
          </Button>
        </div>
      )}
    </div>
  );
});
