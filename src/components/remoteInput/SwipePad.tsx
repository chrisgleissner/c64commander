/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveSwipeDirections, SWIPE_TAP_HOLD_MS } from "@/lib/remoteInput/swipeGesture";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import type { JoystickInputName } from "@/lib/c64api";

export type SwipePadProps = {
  heldInputs: HeldJoystickInputs;
  onHeldInputsChange: (next: HeldJoystickInputs) => void;
  disabled?: boolean;
};

/**
 * A large, forgiving swipe surface: a quick directional flick anywhere in it
 * sends a brief directional tap (held for {@link SWIPE_TAP_HOLD_MS}, long
 * enough to survive the transport's coalescing window, then auto-released) -
 * distinct from the stick/D-pad's sustained hold-while-touching model. Good
 * for "one nudge" menu/high-score navigation without needing precise control.
 */
export const SwipePad = ({ heldInputs, onHeldInputsChange, disabled = false }: SwipePadProps) => {
  const originRef = useRef<{ x: number; y: number; atMs: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const [lastSwipeDirections, setLastSwipeDirections] = useState<JoystickInputName[]>([]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      activePointerIdRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY, atMs: Date.now() };
    },
    [disabled],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || activePointerIdRef.current !== event.pointerId || !originRef.current) return;
      const origin = originRef.current;
      activePointerIdRef.current = null;
      originRef.current = null;
      const directions = resolveSwipeDirections({
        dx: event.clientX - origin.x,
        dy: event.clientY - origin.y,
        durationMs: Date.now() - origin.atMs,
      });
      if (!directions.length) return;

      if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);
      setLastSwipeDirections(directions);
      const next = new Set(heldInputs);
      directions.forEach((input) => next.add(input));
      onHeldInputsChange(next);

      releaseTimerRef.current = window.setTimeout(() => {
        releaseTimerRef.current = null;
        setLastSwipeDirections([]);
        onHeldInputsChange(new Set([...next].filter((input) => !directions.includes(input))) as HeldJoystickInputs);
      }, SWIPE_TAP_HOLD_MS);
    },
    [disabled, heldInputs, onHeldInputsChange],
  );

  const cancel = useCallback(() => {
    activePointerIdRef.current = null;
    originRef.current = null;
  }, []);

  return (
    <div
      className={cn(
        "flex h-32 w-32 touch-none items-center justify-center rounded-xl border border-dashed border-border bg-muted text-center text-xs text-muted-foreground",
        disabled && "opacity-40",
      )}
      data-testid="remote-input-swipe-pad"
      data-last-swipe={lastSwipeDirections.join("+") || undefined}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancel}
    >
      Swipe to move
    </div>
  );
};
