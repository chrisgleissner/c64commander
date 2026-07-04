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
import { vibrateTap } from "@/lib/remoteInput/haptics";
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
  /** Control-size multiplier (from the user's size preference). */
  scale?: number;
  /** Immersive/gaming layout: edge-anchored, maximized, no-look thumb reach. */
  immersive?: boolean;
};

type MovementStyle = "stick" | "dpad" | "swipe";

const MOVEMENT_STYLES: ReadonlyArray<{ id: MovementStyle; label: string; icon: typeof Gamepad2 }> = [
  { id: "stick", label: "Stick", icon: Gamepad2 },
  { id: "dpad", label: "D-Pad", icon: Hand },
  { id: "swipe", label: "Swipe", icon: MoveDiagonal },
];

/** Thumb displacement past this fraction of the stick radius resolves to a direction (generous dead zone). */
const DEAD_ZONE_FRACTION = 0.25;
/** Base geometry (px) at scale 1.0; the user's size preference multiplies these. */
const BASE_CONTROL_PX = 132;
const BASE_FIRE_PX = 92;

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
  scale = 1,
  immersive = false,
}: VirtualJoystickProps) => {
  const stickZoneRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const directionsRef = useRef<JoystickInputName[]>([]);
  const [stickOffset, setStickOffset] = useState({ x: 0, y: 0 });
  const [movementStyle, setMovementStyle] = useState<MovementStyle>("stick");

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const controlPx = Math.round(BASE_CONTROL_PX * safeScale);
  const thumbPx = Math.round(Math.max(40, controlPx * 0.36));
  const firePx = Math.round(BASE_FIRE_PX * safeScale);

  const applyDirections = useCallback(
    (next: JoystickInputName[]) => {
      const changed =
        next.length !== directionsRef.current.length || next.some((d, i) => d !== directionsRef.current[i]);
      if (!changed) return;
      directionsRef.current = next;
      if (next.length) vibrateTap(10);
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
        vibrateTap(15);
      } else {
        next.delete(input);
      }
      onHeldInputsChange(next);
    },
    [disabled, heldInputs, onHeldInputsChange],
  );

  const movementControl =
    movementStyle === "stick" ? (
      <div
        ref={stickZoneRef}
        className={cn(
          "relative shrink-0 touch-none rounded-full border border-border bg-muted",
          disabled && "opacity-40",
        )}
        style={{ width: controlPx, height: controlPx }}
        data-testid="remote-input-stick-zone"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releaseStick}
        onPointerCancel={releaseStick}
      >
        <div
          className="absolute left-1/2 top-1/2 rounded-full bg-primary shadow"
          style={{
            width: thumbPx,
            height: thumbPx,
            transform: `translate(-50%, -50%) translate(${stickOffset.x}px, ${stickOffset.y}px)`,
          }}
          data-testid="remote-input-stick-thumb"
          data-pressed={directionsRef.current.length > 0 ? "true" : "false"}
        />
      </div>
    ) : movementStyle === "dpad" ? (
      <VirtualDPad
        heldInputs={heldInputs}
        onHeldInputsChange={onHeldInputsChange}
        disabled={disabled}
        sizePx={controlPx}
      />
    ) : (
      <SwipePad
        heldInputs={heldInputs}
        onHeldInputsChange={onHeldInputsChange}
        disabled={disabled}
        sizePx={controlPx}
      />
    );

  const fireButton = (
    <Button
      variant={heldInputs.has("fire") ? "default" : "secondary"}
      className="rounded-full text-base font-bold shadow-lg"
      style={{ width: firePx, height: firePx }}
      disabled={disabled}
      data-testid="remote-input-fire-button"
      data-pressed={heldInputs.has("fire") ? "true" : "false"}
      onPointerDown={() => setFireHeld("fire", true)}
      onPointerUp={() => setFireHeld("fire", false)}
      onPointerCancel={() => setFireHeld("fire", false)}
    >
      FIRE
    </Button>
  );

  return (
    <div className={cn("flex flex-col gap-3", immersive && "h-full")} data-testid="remote-input-virtual-joystick">
      {disabled ? (
        <p className="text-center text-sm text-muted-foreground" data-testid="remote-input-joystick-unavailable-hint">
          {disabledHint}
        </p>
      ) : null}

      {/* Occasional toggles live in a top row, away from the constant-use action
          zone below, so mid-game thumbs never accidentally flip the port or
          autofire. The port swap is further separated by a divider. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" data-testid="remote-input-movement-style-toggle">
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
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm" data-testid="remote-input-autofire-toggle">
            <Switch
              checked={autofireEnabled}
              onCheckedChange={onAutofireEnabledChange}
              disabled={disabled}
              data-testid="remote-input-autofire-switch"
            />
            Autofire
          </label>
          {/* Port swap kept "a bit separate" (its own divided cell) — a
              deliberate action, not something to hit while firing. */}
          <label
            className="flex items-center gap-2 border-l border-border pl-3 text-sm"
            data-testid="remote-input-port-toggle"
          >
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

      {/* Action zone: big directional control + big FIRE. In immersive mode the
          two are anchored to the bottom corners for no-look thumb reach. */}
      <div className={cn("flex items-end justify-between gap-4", immersive && "relative min-h-0 flex-1")}>
        <div className={cn(immersive && "absolute bottom-1 left-1")}>{movementControl}</div>
        <div className={cn("flex items-center", immersive && "absolute bottom-1 right-1")}>{fireButton}</div>
      </div>
    </div>
  );
};
