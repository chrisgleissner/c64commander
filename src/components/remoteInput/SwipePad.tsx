/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { vibrateTap } from "@/lib/remoteInput/haptics";
import { capturePointerBestEffort } from "@/lib/remoteInput/pointerCapture";
import { resolveDragDirections } from "@/lib/remoteInput/dragDirectionResolution";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import type { JoystickInputName } from "@/lib/c64api";

export type SwipePadProps = {
  heldInputs: HeldJoystickInputs;
  onHeldInputsChange: (next: HeldJoystickInputs) => void;
  disabled?: boolean;
  /** Square size of the swipe surface, in px (defaults to the compact 128px). */
  sizePx?: number;
};

const AXIS_DIRECTIONS: ReadonlyArray<JoystickInputName> = ["up", "down", "left", "right"];

/**
 * A large, forgiving free-drag surface: drag anywhere in it and the joystick
 * follows the drawn path continuously (the same live 8-way resolution as the
 * Analog stick, just without a fixed knob/dead-zone visual), releasing the
 * instant the finger lifts. Unlike the stick it has no bounded origin — the
 * drag starts wherever the finger lands — so it suits fast, sweeping menu and
 * gameplay movement without hunting for a knob.
 */
export const SwipePad = ({ heldInputs, onHeldInputsChange, disabled = false, sizePx = 128 }: SwipePadProps) => {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const directionsRef = useRef<JoystickInputName[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dotOffset, setDotOffset] = useState({ x: 0, y: 0 });

  const applyDirections = useCallback(
    (next: JoystickInputName[]) => {
      const changed =
        next.length !== directionsRef.current.length || next.some((d, i) => d !== directionsRef.current[i]);
      if (!changed) return;
      directionsRef.current = next;
      if (next.length) vibrateTap(10);
      // Replace only the four movement axes, so an input held via another
      // control (e.g. fire) is never clobbered by the drag.
      const nextHeld = new Set(heldInputs);
      AXIS_DIRECTIONS.forEach((direction) => nextHeld.delete(direction));
      next.forEach((direction) => nextHeld.add(direction));
      onHeldInputsChange(nextHeld);
    },
    [heldInputs, onHeldInputsChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // HARD20-001: keep the original drag authoritative until it ends.
      if (disabled || activePointerIdRef.current !== null) return;
      const zone = zoneRef.current;
      if (zone) capturePointerBestEffort(zone, event.pointerId, "swipe pad");
      activePointerIdRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY };
      setDragging(true);
      setDotOffset({ x: 0, y: 0 });
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== event.pointerId || !originRef.current) return;
      const zone = zoneRef.current;
      const radius = zone ? zone.clientWidth / 2 : 60;
      const dx = event.clientX - originRef.current.x;
      const dy = event.clientY - originRef.current.y;
      const clampedDistance = Math.min(Math.hypot(dx, dy), radius);
      const angle = Math.atan2(dy, dx);
      setDotOffset({ x: Math.cos(angle) * clampedDistance, y: Math.sin(angle) * clampedDistance });
      applyDirections(resolveDragDirections(dx, dy, radius));
    },
    [applyDirections],
  );

  const release = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // HARD20-001: a stray pointer-up/cancel must not release another drag.
      if (event.pointerId !== activePointerIdRef.current) return;
      activePointerIdRef.current = null;
      originRef.current = null;
      setDragging(false);
      setDotOffset({ x: 0, y: 0 });
      applyDirections([]);
    },
    [applyDirections],
  );

  return (
    <div
      ref={zoneRef}
      className={cn(
        "relative flex touch-none items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted text-center text-xs text-muted-foreground",
        disabled && "opacity-40",
      )}
      style={{ width: sizePx, height: sizePx }}
      data-testid="remote-input-swipe-pad"
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {dragging ? (
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full bg-primary shadow"
          style={{
            width: Math.max(24, Math.round(sizePx * 0.22)),
            height: Math.max(24, Math.round(sizePx * 0.22)),
            transform: `translate(-50%, -50%) translate(${dotOffset.x}px, ${dotOffset.y}px)`,
          }}
          data-testid="remote-input-swipe-dot"
          aria-hidden="true"
        />
      ) : (
        "Drag to move"
      )}
    </div>
  );
};
