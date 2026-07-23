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
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";
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
  className?: string;
}

const DOUBLE_TAP_MS = 300;
const CONTROLS_HIDE_MS = 2600;
const ZOOM_STEP = 1.5;

const haptic = () => {
  try {
    (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(12);
  } catch {
    /* haptics unavailable */
  }
};

/**
 * The maximised, controllable screen mirror for Remote Input game mode. Native-res
 * decode is GPU-scaled, so zoom is fixed-cost even on the Callback 8020. The one hard
 * rule (06-av-mirror-ux §7.1): physical input is NEVER ambiguous — a colour-coded
 * view-lock mode (blue = Driving C64, amber = Adjusting view) makes the current role
 * unmistakable, flippable by an on-screen button, a physical key (via the ref), and it
 * auto-reverts to Drive after idle. Touch on the picture always adjusts; the joystick /
 * keyboard controls always relay.
 */
export const AvMirrorImmersive = forwardRef<AvMirrorImmersiveHandle, AvMirrorImmersiveProps>(function AvMirrorImmersive(
  { session, onModeChange, className },
  ref,
) {
  const { videoLive, video } = useAvMirror(session);
  const [follow, setFollow] = useState(false);
  const { viewport, zoomBy, panBy, centerOn, reset } = useMirrorViewport({ session, follow });
  const [mode, setModeState] = useState<MirrorInputMode>("drive");
  const [controlsVisible, setControlsVisible] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  useAvMirrorCanvas(canvasRef, session);

  const viewportStateRef = useRef(viewport);
  viewportStateRef.current = viewport;

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setMode = useCallback(
    (next: MirrorInputMode) => {
      setModeState((prev) => {
        if (prev !== next) haptic();
        return next;
      });
      onModeChange?.(next);
    },
    [onModeChange],
  );
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
      panStep: (dx, dy) => {
        bumpIdle();
        const scale = viewportStateRef.current.scale;
        panBy((dx * KEY_PAN_STEP) / scale, (dy * KEY_PAN_STEP) / scale);
      },
      toggleMode,
      getMode: () => modeRef.current,
    }),
    [zoomBy, panBy, reset, toggleMode, bumpIdle],
  );

  // --- Touch gestures on the picture (always view-control, per §7.1) ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number } | null>(null);
  const lastTapRef = useRef(0);

  const stageMetrics = () => {
    const el = stageRef.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 ? b : null;
  };

  const focalFromPoint = (clientX: number, clientY: number, bounds: DOMRect) => {
    const rect = viewportRect(viewport);
    return {
      x: rect.x + ((clientX - bounds.left) / bounds.width) * rect.w,
      y: rect.y + ((clientY - bounds.top) / bounds.height) * rect.h,
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
      const bounds = stageMetrics();
      if (now - lastTapRef.current < DOUBLE_TAP_MS && bounds) {
        // double-tap: zoom toward the point, or reset when already zoomed in
        if (viewport.scale > 1.05) reset();
        else zoomBy(3, focalFromPoint(event.clientX, event.clientY, bounds));
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(event.pointerId);
    if (!prev) return;
    const bounds = stageMetrics();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!bounds) return;

    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.dist > 0) {
        const factor = dist / pinchRef.current.dist;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        zoomBy(factor, focalFromPoint(midX, midY, bounds));
      }
      pinchRef.current.dist = dist;
    } else if (pointers.current.size === 1) {
      const dx = -((event.clientX - prev.x) / bounds.width) / viewport.scale;
      const dy = -((event.clientY - prev.y) / bounds.height) / viewport.scale;
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
        adjust ? "border-amber-400" : "border-primary",
        className,
      )}
      data-testid="av-mirror-immersive"
      data-mode={mode}
    >
      {/* Mode banner — the glanceable, unmistakable "who owns input" signal. */}
      <div className="pointer-events-none absolute left-2 top-2 z-10">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow",
            adjust ? "bg-amber-500" : "bg-primary",
          )}
          data-testid="av-mirror-mode-chip"
        >
          {adjust ? <ScanEye className="h-3 w-3" /> : <Gamepad2 className="h-3 w-3" />}
          {adjust ? "Adjusting view" : "Driving C64"}
        </span>
      </div>

      <div
        ref={stageRef}
        className="relative w-full touch-none select-none"
        style={{ aspectRatio: "384 / 272" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        data-testid="av-mirror-immersive-stage"
      >
        <canvas
          ref={canvasRef}
          width={384}
          height={272}
          className="block w-full origin-top-left will-change-transform"
          style={{ imageRendering: "pixelated", aspectRatio: "384 / 272", transform }}
          data-testid="av-mirror-immersive-canvas"
        />
        {!videoLive && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white/70">
            {video.state === "connecting"
              ? "Connecting…"
              : video.state === "error"
                ? "Video unavailable"
                : "Not watching"}
          </div>
        )}
      </div>

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
            onClick={toggleMode}
            data-testid="av-immersive-mode-toggle"
          >
            {adjust ? "Done" : "Adjust"}
          </Button>
        </div>
      )}
    </div>
  );
});
