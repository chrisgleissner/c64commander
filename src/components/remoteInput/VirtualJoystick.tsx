/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";
import { Gamepad2, Hand, MoveDiagonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { VirtualDPad } from "@/components/remoteInput/VirtualDPad";
import { SwipePad } from "@/components/remoteInput/SwipePad";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import type { JoystickInputName } from "@/lib/c64api";

export type VirtualJoystickProps = {
  port: 1 | 2;
  onSetPort: (port: 1 | 2) => void;
  heldInputs: HeldJoystickInputs;
  onHeldInputsChange: (next: HeldJoystickInputs) => void;
  autofireEnabled: boolean;
  onAutofireEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
  disabledHint?: string;
};

type MovementStyle = "stick" | "dpad" | "swipe";

const MOVEMENT_STYLES: ReadonlyArray<{ id: MovementStyle; label: string; icon: typeof Gamepad2 }> = [
  { id: "stick", label: "Stick", icon: Gamepad2 },
  { id: "dpad", label: "D-Pad", icon: Hand },
  { id: "swipe", label: "Swipe", icon: MoveDiagonal },
];

/** Thumb displacement past this fraction of the stick radius resolves to a direction (generous dead zone). */
const DEAD_ZONE_FRACTION = 0.25;

const vibrate = (ms: number) => {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ms);
  }
};

const resolveDirections = (dx: number, dy: number, radius: number): JoystickInputName[] => {
  const distance = Math.hypot(dx, dy);
  if (distance < radius * DEAD_ZONE_FRACTION) return [];
  const angle = Math.atan2(dy, dx);
  const directions: JoystickInputName[] = [];
  // 8-way resolution: split the circle into horizontal/vertical components.
  if (Math.cos(angle) > 0.35) directions.push("right");
  else if (Math.cos(angle) < -0.35) directions.push("left");
  if (Math.sin(angle) > 0.35) directions.push("down");
  else if (Math.sin(angle) < -0.35) directions.push("up");
  return directions;
};

export const VirtualJoystick = ({
  port,
  onSetPort,
  heldInputs,
  onHeldInputsChange,
  autofireEnabled,
  onAutofireEnabledChange,
  disabled = false,
  disabledHint,
}: VirtualJoystickProps) => {
  const stickZoneRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const directionsRef = useRef<JoystickInputName[]>([]);
  const [stickOffset, setStickOffset] = useState({ x: 0, y: 0 });
  const [movementStyle, setMovementStyle] = useState<MovementStyle>("stick");

  const applyDirections = useCallback(
    (next: JoystickInputName[]) => {
      const changed =
        next.length !== directionsRef.current.length || next.some((d, i) => d !== directionsRef.current[i]);
      if (!changed) return;
      directionsRef.current = next;
      if (next.length) vibrate(10);
      const nextHeld = new Set(heldInputs);
      (["up", "down", "left", "right"] as const).forEach((direction) => nextHeld.delete(direction));
      next.forEach((direction) => nextHeld.add(direction));
      onHeldInputsChange(nextHeld);
    },
    [heldInputs, onHeldInputsChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const zone = stickZoneRef.current;
      if (!zone) return;
      try {
        zone.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture is best-effort (some older WebViews lack support):
        // the drag still mostly works via ordinary move events as long as the
        // finger stays over the zone, so degrade rather than let this become
        // an uncaught exception that aborts the whole gesture.
        addLog(
          "warn",
          "Remote input stick pointer capture unavailable",
          buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), {
            pointerId: event.pointerId,
          }),
        );
      }
      activePointerIdRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY };
      setStickOffset({ x: 0, y: 0 });
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== event.pointerId || !originRef.current) return;
      const zone = stickZoneRef.current;
      const radius = zone ? zone.clientWidth / 2 : 60;
      const dx = event.clientX - originRef.current.x;
      const dy = event.clientY - originRef.current.y;
      const clampedDistance = Math.min(Math.hypot(dx, dy), radius);
      const angle = Math.atan2(dy, dx);
      setStickOffset({ x: Math.cos(angle) * clampedDistance, y: Math.sin(angle) * clampedDistance });
      applyDirections(resolveDirections(dx, dy, radius));
    },
    [applyDirections],
  );

  const releaseStick = useCallback(() => {
    activePointerIdRef.current = null;
    originRef.current = null;
    setStickOffset({ x: 0, y: 0 });
    applyDirections([]);
  }, [applyDirections]);

  const setFireHeld = useCallback(
    (input: JoystickInputName, held: boolean) => {
      if (disabled) return;
      const next = new Set(heldInputs);
      if (held) {
        next.add(input);
        vibrate(15);
      } else {
        next.delete(input);
      }
      onHeldInputsChange(next);
    },
    [disabled, heldInputs, onHeldInputsChange],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="remote-input-virtual-joystick">
      {disabled ? (
        <p className="text-center text-sm text-muted-foreground" data-testid="remote-input-joystick-unavailable-hint">
          {disabledHint}
        </p>
      ) : null}

      {/* Movement style: an easy, explicit one-tap switch (matching the
          Autofire/Port switches' directness) between the three touch input
          methods, plus the always-available physical D-pad/keyboard arrows
          which work regardless of which touch style is selected. */}
      <div className="flex items-center justify-center gap-2" data-testid="remote-input-movement-style-toggle">
        {MOVEMENT_STYLES.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            size="sm"
            variant={movementStyle === id ? "default" : "secondary"}
            disabled={disabled}
            data-testid={`remote-input-movement-style-${id}`}
            onClick={() => setMovementStyle(id)}
          >
            <Icon className="mr-1.5 h-4 w-4" /> {label}
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-6">
        {movementStyle === "stick" ? (
          <div
            ref={stickZoneRef}
            className={cn(
              "relative h-32 w-32 shrink-0 touch-none rounded-full border border-border bg-muted",
              disabled && "opacity-40",
            )}
            data-testid="remote-input-stick-zone"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={releaseStick}
            onPointerCancel={releaseStick}
          >
            <div
              className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-primary shadow"
              data-testid="remote-input-stick-thumb"
              data-pressed={directionsRef.current.length > 0 ? "true" : "false"}
              style={{ transform: `translate(-50%, -50%) translate(${stickOffset.x}px, ${stickOffset.y}px)` }}
            />
          </div>
        ) : movementStyle === "dpad" ? (
          <VirtualDPad heldInputs={heldInputs} onHeldInputsChange={onHeldInputsChange} disabled={disabled} />
        ) : (
          <SwipePad heldInputs={heldInputs} onHeldInputsChange={onHeldInputsChange} disabled={disabled} />
        )}

        <div className="flex flex-col items-center gap-2">
          <Button
            size="lg"
            variant={heldInputs.has("fire") ? "default" : "secondary"}
            className="h-16 w-16 rounded-full"
            disabled={disabled}
            data-testid="remote-input-fire-button"
            data-pressed={heldInputs.has("fire") ? "true" : "false"}
            onPointerDown={() => setFireHeld("fire", true)}
            onPointerUp={() => setFireHeld("fire", false)}
            onPointerCancel={() => setFireHeld("fire", false)}
          >
            FIRE
          </Button>
          <label className="flex items-center gap-2 text-sm" data-testid="remote-input-autofire-toggle">
            <Switch
              checked={autofireEnabled}
              onCheckedChange={onAutofireEnabledChange}
              disabled={disabled}
              data-testid="remote-input-autofire-switch"
            />
            Autofire
          </label>
          {/* One-tap swap, matching the Autofire switch's directness — swapping
              which port is controlled is a common mid-game action (2-player
              swap, "wrong port" games), so it must not require picking from a
              list or navigating two separate buttons. */}
          <label className="flex items-center gap-2 text-sm" data-testid="remote-input-port-toggle">
            <Switch
              checked={port === 2}
              onCheckedChange={(checked) => onSetPort(checked ? 2 : 1)}
              disabled={disabled}
              data-testid="remote-input-port-switch"
            />
            Port {port}
          </label>
        </div>
      </div>
    </div>
  );
};
