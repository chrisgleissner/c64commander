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
import { Crosshair, Joystick, Maximize, Minus, Plus, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAvMirror, useAvMirrorCanvas } from "@/hooks/useAvMirror";
import { useMirrorViewport } from "@/hooks/useMirrorViewport";
import { useStreamVideoBadges } from "@/hooks/useStreamVideoBadges";
import { viewportRect, type Viewport } from "@/lib/streams/mirrorViewport";
import type { MirrorLock } from "@/hooks/useMirrorViewport";
import type { LockState } from "@/lib/streams/subjectTracker";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import { loadFollowReticle, subscribeFollowReticle } from "@/lib/streams/followReticle";
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
  /**
   * Lock on to whatever is in the middle of the view, or let it go if something is already
   * locked — the keypad route into follow-focus, and the whole of it.
   *
   * A handset with no touchscreen has no long press to make, so the view itself is the aim: the
   * D-pad already pans it in Adjust mode, a crosshair marks the centre, and this confirms what
   * is under the crosshair. It turns following on if it was off, so the user needs to know about
   * one key rather than two.
   */
  toggleLock: () => void;
}

const KEY_PAN_STEP = 0.35; // fraction of the visible region per key press

export interface AvMirrorImmersiveProps {
  session?: AvMirrorSession;
  onModeChange?: (mode: MirrorInputMode) => void;
  /** How far the app's frame appears turned to the player; the picture is turned back by this. */
  rotation?: DeviceRotation;
  /** Take all the height available instead of sizing to the frame's aspect. */
  fill?: boolean;
  /**
   * What the app is asserting on the joystick right now, when the player is steering with the
   * app rather than with something plugged into the C64. Used only to break ties between
   * look-alike objects, and only once the game has been shown to answer the stick at all.
   */
  heldJoystickInputs?: HeldJoystickInputs;
  className?: string;
}

const DOUBLE_TAP_MS = 300;
/** Long enough that it cannot be a tap, short enough to feel deliberate. */
const LONG_PRESS_MS = 480;
/** A finger that travels this far is panning, not pressing. */
const LONG_PRESS_MOVE_PX = 12;
export const CONTROLS_HIDE_MS = 2600;
const ZOOM_STEP = 1.5;
const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 272;
const FRAME_ASPECT = FRAME_WIDTH / FRAME_HEIGHT;

/**
 * What the status chip says. `coasting` deliberately reads the same as `locked`: the view is
 * still following the same thing, it is just less sure for a moment, and a word that changes
 * every time a sprite passes behind a wall pulls the player's eye off the game. The colour
 * carries the certainty; the word carries the fact.
 */
const LOCK_LABELS: Record<LockState, string | null> = {
  idle: null,
  locked: "Locked on",
  coasting: "Locked on",
  searching: "Looking…",
  lost: "Lost it",
};

/**
 * The reticle in STAGE coords: the subject's position inside the visible region, as a fraction
 * of the stage. Placing it here rather than inside the canvas's own zoom transform keeps its
 * outline 2px wide at every zoom level instead of scaling up with the picture.
 */
const lockReticle = (lock: MirrorLock, viewport: Viewport) => {
  if (!lock.subject || lock.state === "idle" || lock.state === "lost") return null;
  const rect = viewportRect(viewport);
  const x = (lock.subject.x - rect.x) / rect.w;
  const y = (lock.subject.y - rect.y) / rect.h;
  if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return null;
  // A floor as well as a ceiling. A C64 sprite on a 320px-wide handset is a handful of pixels
  // across, and a marker that honestly reports that size is one nobody over forty can see.
  const clampSize = (value: number) => Math.min(1, Math.max(0.14, value));
  return { x, y, w: clampSize(lock.subject.w / rect.w), h: clampSize(lock.subject.h / rect.h) };
};

/** The four L-shaped brackets: two borders each, anchored to their own corner. */
const RETICLE_CORNERS = [
  { key: "tl", className: "left-0 top-0 border-l-2 border-t-2" },
  { key: "tr", className: "right-0 top-0 border-r-2 border-t-2" },
  { key: "bl", className: "bottom-0 left-0 border-b-2 border-l-2" },
  { key: "br", className: "bottom-0 right-0 border-b-2 border-r-2" },
] as const;

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
  { session, onModeChange, rotation = 0, fill = false, heldJoystickInputs, className },
  ref,
) {
  const { videoLive, video } = useAvMirror(session);
  const showBadges = useStreamVideoBadges();
  const [follow, setFollow] = useState(false);
  const { viewport, lock, zoomBy, panBy, centerOn, reset, lockOn, releaseLock } = useMirrorViewport({
    session,
    follow,
    heldJoystickInputs,
  });
  const [mode, setModeState] = useState<MirrorInputMode>("drive");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [reticleEnabled, setReticleEnabled] = useState(loadFollowReticle);
  useEffect(() => subscribeFollowReticle(setReticleEnabled), []);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useAvMirrorCanvas(canvasRef, session);

  const viewportStateRef = useRef(viewport);
  viewportStateRef.current = viewport;
  const lockStateRef = useRef(lock.state);
  lockStateRef.current = lock.state;

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
      toggleLock: () => {
        bumpIdle();
        haptic();
        if (lockStateRef.current !== "idle" && lockStateRef.current !== "lost") {
          releaseLock();
          return;
        }
        setFollow(true);
        const centre = viewportStateRef.current;
        lockOn(centre.cx, centre.cy);
      },
    }),
    [zoomBy, panBy, reset, toggleMode, bumpIdle, rotation, lockOn, releaseLock],
  );

  // --- Touch gestures on the picture (always view-control, per §7.1) ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number } | null>(null);
  const lastTapRef = useRef(0);
  const longPressRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  const cancelLongPress = useCallback(() => {
    const press = longPressRef.current;
    if (!press) return;
    clearTimeout(press.timer);
    longPressRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

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
      cancelLongPress();
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    } else if (pointers.current.size === 1) {
      const now = Date.now();
      const frame = stageFrame();
      // Press and hold on something to lock on to it. Armed only while Follow is on, so a
      // long press changes nothing for a user who has not asked the view to follow anything.
      if (follow && frame) {
        const focal = focalFromPoint(event.clientX, event.clientY, frame);
        const timer = setTimeout(() => {
          longPressRef.current = null;
          haptic();
          lockOn(focal.x, focal.y);
        }, LONG_PRESS_MS);
        longPressRef.current = { timer, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }
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
    const press = longPressRef.current;
    if (press && press.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_MOVE_PX) cancelLongPress();
    }
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
    cancelLongPress();
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
  };

  const adjust = mode === "adjust";
  const reticle = reticleEnabled ? lockReticle(lock, viewport) : null;
  const aiming = adjust && videoLive && !reticle && (lock.state === "idle" || lock.state === "lost");
  const lockLabel = LOCK_LABELS[lock.state];
  const transform = `translate(${((0.5 - viewport.scale * viewport.cx) * 100).toFixed(3)}%, ${(
    (0.5 - viewport.scale * viewport.cy) *
    100
  ).toFixed(3)}%) scale(${viewport.scale.toFixed(3)})`;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-media-letterbox transition-colors",
        // shrink-0 keeps the measured height inside the Remote Input flex column, which
        // would otherwise collapse the mirror to its borders. Filling instead gives the
        // picture every pixel the sheet body is not using.
        fill ? "min-h-0 flex-1" : "shrink-0",
        // Edge colour signals the input mode (blue "C64" = driving the machine, amber "View" =
        // adjusting the view), not the style token: previously a border-color utility with no
        // border-width to apply to, a no-op left behind when D10 moved edges to box-shadow.
        adjust ? "shadow-[inset_0_0_0_2px_theme(colors.amber.400)]" : "shadow-[inset_0_0_0_2px_hsl(var(--primary))]",
        className,
      )}
      data-testid="av-mirror-immersive"
      data-mode={mode}
      data-rotation={rotation}
      data-lock-state={lock.state}
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
        <div
          className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2"
          data-testid="av-mirror-status-row"
        >
          <span className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-media-on-scrim shadow",
                adjust ? "bg-amber-500" : "bg-primary",
              )}
              role="status"
              aria-label={adjust ? "Adjusting view" : "Driving C64"}
              data-testid="av-mirror-mode-chip"
            >
              {adjust ? <ScanEye className="h-3 w-3" /> : <Joystick className="h-3 w-3" />}
              {adjust ? "View" : "C64"}
            </span>
            {/* Follow is on but nothing is locked yet. A long press is not a gesture this app's
                users go looking for, and the keypad edition has no touchscreen at all, so the
                two routes into it are spelled out in the same status row that reports the
                result. It disappears the moment there is a lock to report instead. */}
            {(follow || adjust) && !lockLabel && controlsVisible && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-media-scrim/60 px-2 py-0.5 text-xs text-media-on-scrim/90 shadow"
                data-testid="av-immersive-lock-hint"
              >
                <Crosshair className="h-3 w-3" aria-hidden="true" />
                {adjust ? "Line it up, press OK" : "Hold on your character"}
              </span>
            )}
            {/* The chip that says the view is locked is also the way out of it: tapping the thing
                that reports the state is where a user looks first, and it needs no second control. */}
            {follow && lockLabel && (
              <button
                type="button"
                className={cn(
                  "pointer-events-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-media-on-scrim shadow",
                  lock.state === "locked" ? "bg-emerald-600" : "bg-amber-500",
                )}
                aria-label={`${lockLabel} on an object. Tap to go back to following motion.`}
                onClick={() => {
                  haptic();
                  releaseLock();
                }}
                data-testid="av-immersive-lock-status"
                data-lock-state={lock.state}
              >
                <Crosshair className="h-3 w-3" aria-hidden="true" />
                {lockLabel}
              </button>
            )}
          </span>
          {showBadges && videoLive && video.fps > 0 && (
            <span
              className="rounded-sm bg-media-scrim/60 px-1.5 py-0.5 text-xs leading-tight text-media-on-scrim/80"
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
          {/* Four corner brackets rather than a full outline, and sized to the subject's own
              bounding box so it breathes as the sprite animates: the same thing a camera draws
              round a face, and the least ink that still says WHICH object is being followed. */}
          {/* The aim. In Adjust mode the D-pad pans the picture under a crosshair that stays in
              the middle, so lining something up and pressing OK is the whole gesture on a
              handset with no touchscreen. It is hidden once there is a lock to show instead. */}
          {aiming && (
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2"
              data-testid="av-immersive-lock-aim"
            >
              <span className="absolute left-1/2 top-0 h-2.5 w-0.5 -translate-x-1/2 bg-media-reticle/90 shadow" />
              <span className="absolute bottom-0 left-1/2 h-2.5 w-0.5 -translate-x-1/2 bg-media-reticle/90 shadow" />
              <span className="absolute left-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-media-reticle/90 shadow" />
              <span className="absolute right-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-media-reticle/90 shadow" />
            </div>
          )}
          {reticle && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${(reticle.x * 100).toFixed(3)}%`,
                top: `${(reticle.y * 100).toFixed(3)}%`,
                width: `${(reticle.w * 100).toFixed(3)}%`,
                height: `${(reticle.h * 100).toFixed(3)}%`,
                transform: "translate(-50%, -50%)",
              }}
              data-testid="av-immersive-lock-reticle"
              data-lock-state={lock.state}
            >
              {RETICLE_CORNERS.map((corner) => (
                <span
                  key={corner.key}
                  className={cn(
                    // A dark drop shadow, because every colour in this marker is also a colour
                    // the game can paint behind it — the C64 has sixteen and uses all of them.
                    "absolute h-1/3 w-1/3 drop-shadow-[0_0_2px_hsl(var(--media-scrim)/0.9)] transition-colors",
                    corner.className,
                    lock.state === "locked" ? "border-emerald-400" : "border-amber-400",
                  )}
                  style={{ minWidth: 10, minHeight: 10 }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {!videoLive && (
        <div className="absolute inset-0 flex items-center justify-center bg-media-scrim/70 text-sm text-media-on-scrim/70">
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
          className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-full bg-media-scrim/55 p-1 backdrop-blur"
          data-testid="av-mirror-immersive-controls"
        >
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-media-on-scrim hover:bg-media-on-scrim/15"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            data-testid="av-immersive-zoom-out"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-media-on-scrim hover:bg-media-on-scrim/15"
            aria-label="Zoom in"
            onClick={() => zoomBy(ZOOM_STEP)}
            data-testid="av-immersive-zoom-in"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-media-on-scrim hover:bg-media-on-scrim/15"
            aria-label="Fit to screen"
            onClick={reset}
            data-testid="av-immersive-fit"
          >
            <Maximize className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant={follow ? "default" : "ghost"}
            className={cn("h-8 w-8", follow ? "" : "text-media-on-scrim hover:bg-media-on-scrim/15")}
            aria-label="Follow motion"
            aria-pressed={follow}
            title={follow ? "Following motion — press and hold the picture to lock on" : "Follow motion"}
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
