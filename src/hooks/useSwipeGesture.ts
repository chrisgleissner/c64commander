/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef } from "react";
import { addLog } from "@/lib/logging";

export const SWIPE_COMMIT_THRESHOLD_PX = 40;
export const AXIS_LOCK_THRESHOLD_PX = 10;
export const SWIPE_VELOCITY_THRESHOLD_PX_PER_MS = 0.25;

export type GestureIntent = "undecided" | "navigating" | "locked";
export type SwipeDirection = 1 | -1;

export type SwipeGestureMetadata = {
  dx: number;
  dy: number;
  velocityX: number;
};

export const classifyGestureIntent = (dx: number, dy: number): GestureIntent => {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < AXIS_LOCK_THRESHOLD_PX && ady < AXIS_LOCK_THRESHOLD_PX) return "undecided";
  if (adx > ady) return "navigating";
  return "locked";
};

const isHorizontallyScrollable = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return false;
  const style = window.getComputedStyle(element);
  if (!["auto", "scroll"].includes(style.overflowX)) return false;
  return element.scrollWidth > element.clientWidth + 1;
};

export const isSwipeExcluded = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;

  let node: Element | null = target;
  while (node) {
    if (node.hasAttribute("data-swipe-exclude")) return true;
    if (node instanceof HTMLInputElement && node.type === "range") return true;
    if (node.getAttribute("role") === "slider") return true;
    if (node.getAttribute("draggable") === "true") return true;
    if (isHorizontallyScrollable(node)) return true;
    node = node.parentElement;
  }

  return false;
};

export const shouldCommitSwipe = (dx: number) => Math.abs(dx) >= SWIPE_COMMIT_THRESHOLD_PX;

export const resolveSwipeDirection = (dx: number): SwipeDirection => (dx < 0 ? 1 : -1);

export type SwipeGestureCallbacks = {
  onProgress: (dx: number, velocityX: number) => void;
  onCommit: (direction: SwipeDirection, metadata: SwipeGestureMetadata) => void;
  onCancel: (metadata: SwipeGestureMetadata) => void;
};

type GestureState = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  lastDx: number;
  lastDy: number;
  velocityX: number;
  intent: GestureIntent;
};

const IDLE: GestureState = {
  active: false,
  pointerId: -1,
  startX: 0,
  startY: 0,
  startTime: 0,
  lastX: 0,
  lastY: 0,
  lastTime: 0,
  lastDx: 0,
  lastDy: 0,
  velocityX: 0,
  intent: "undecided",
};

const buildMetadata = (state: GestureState): SwipeGestureMetadata => ({
  dx: state.lastDx,
  dy: state.lastDy,
  velocityX: state.velocityX,
});

export function useSwipeGesture(
  containerRef: React.RefObject<HTMLElement | null>,
  callbacks: SwipeGestureCallbacks,
): void {
  const stateRef = useRef<GestureState>({ ...IDLE });
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const resetGesture = useCallback(
    (pointerId: number) => {
      const container = containerRef.current;
      if (container?.hasPointerCapture?.(pointerId)) {
        try {
          container.releasePointerCapture(pointerId);
        } catch {
          // Pointer capture may already have been released by the browser.
        }
      }
      stateRef.current = { ...IDLE };
    },
    [containerRef],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent) => {
      if (stateRef.current.active || !event.isPrimary || event.button !== 0) return;

      const excluded = isSwipeExcluded(event.target);
      addLog("debug", "[SwipeNav] gesture-start", {
        x: event.clientX,
        y: event.clientY,
        excluded,
      });

      if (excluded) {
        addLog("debug", "[SwipeNav] gesture-classified", {
          classification: "ignored",
          reason: "interactive-origin",
        });
        return;
      }

      containerRef.current?.setPointerCapture?.(event.pointerId);
      stateRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: event.timeStamp,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        lastDx: 0,
        lastDy: 0,
        velocityX: 0,
        intent: "undecided",
      };
    },
    [containerRef],
  );

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const state = stateRef.current;
    if (!state.active || event.pointerId !== state.pointerId) return;
    if (state.intent === "locked") return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const deltaTime = Math.max(event.timeStamp - state.lastTime, 1);
    const velocityX = (event.clientX - state.lastX) / deltaTime;

    if (state.intent === "undecided") {
      const intent = classifyGestureIntent(dx, dy);
      if (intent === "undecided") {
        stateRef.current = {
          ...state,
          lastX: event.clientX,
          lastY: event.clientY,
          lastTime: event.timeStamp,
          lastDx: dx,
          lastDy: dy,
          velocityX,
        };
        return;
      }

      addLog("debug", "[SwipeNav] gesture-classified", {
        classification: intent,
        dx,
        dy,
      });

      stateRef.current = {
        ...state,
        intent,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        lastDx: dx,
        lastDy: dy,
        velocityX,
      };

      if (intent === "locked") return;
    } else {
      stateRef.current = {
        ...state,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        lastDx: dx,
        lastDy: dy,
        velocityX,
      };
    }

    callbacksRef.current.onProgress(dx, velocityX);
  }, []);

  const handlePointerEnd = useCallback(
    (event: PointerEvent) => {
      const state = stateRef.current;
      if (!state.active || event.pointerId !== state.pointerId) return;

      const nextState: GestureState = {
        ...state,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        lastDx: event.clientX - state.startX,
        lastDy: event.clientY - state.startY,
        velocityX: (event.clientX - state.lastX) / Math.max(event.timeStamp - state.lastTime, 1),
      };
      const metadata = buildMetadata(nextState);

      addLog("debug", "[SwipeNav] gesture-end", {
        intent: nextState.intent,
        ...metadata,
      });

      resetGesture(event.pointerId);

      if (nextState.intent !== "navigating") return;

      if (shouldCommitSwipe(metadata.dx)) {
        const direction = resolveSwipeDirection(metadata.dx);
        addLog("debug", "[SwipeNav] gesture-commit", {
          direction,
          thresholdPx: SWIPE_COMMIT_THRESHOLD_PX,
          velocityThresholdPxPerMs: SWIPE_VELOCITY_THRESHOLD_PX_PER_MS,
          ...metadata,
        });
        callbacksRef.current.onCommit(direction, metadata);
        return;
      }

      addLog("debug", "[SwipeNav] gesture-cancel", {
        thresholdPx: SWIPE_COMMIT_THRESHOLD_PX,
        velocityThresholdPxPerMs: SWIPE_VELOCITY_THRESHOLD_PX_PER_MS,
        ...metadata,
      });
      callbacksRef.current.onCancel(metadata);
    },
    [resetGesture],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("pointerdown", handlePointerDown, { passive: true });
    container.addEventListener("pointermove", handlePointerMove, { passive: true });
    container.addEventListener("pointerup", handlePointerEnd, { passive: true });
    container.addEventListener("pointercancel", handlePointerEnd, { passive: true });

    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerEnd);
      container.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [containerRef, handlePointerDown, handlePointerEnd, handlePointerMove]);
}
