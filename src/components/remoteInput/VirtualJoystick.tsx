/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Gamepad2, Hand, MoveDiagonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { VirtualDPad } from "@/components/remoteInput/VirtualDPad";
import { SwipePad } from "@/components/remoteInput/SwipePad";
import { vibrateTap } from "@/lib/remoteInput/haptics";
import { capturePointerBestEffort } from "@/lib/remoteInput/pointerCapture";
import { resolveDragDirections } from "@/lib/remoteInput/dragDirectionResolution";
import { MAX_AUTOFIRE_RATE_HZ, MIN_AUTOFIRE_RATE_HZ } from "@/lib/remoteInput/autofire";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import type { JoystickInputName } from "@/lib/c64api";

export type VirtualJoystickProps = {
  port: 1 | 2;
  onSetPort: (port: 1 | 2) => void;
  heldInputs: HeldJoystickInputs;
  onHeldInputsChange: (next: HeldJoystickInputs) => void;
  autofireEnabled: boolean;
  onAutofireEnabledChange: (enabled: boolean) => void;
  autofireRateHz: number;
  onAutofireRateHzChange: (rateHz: number) => void;
  disabled?: boolean;
  disabledHint?: string;
  /** Control-size multiplier (from the user's size preference). */
  scale?: number;
  /** Immersive/gaming layout: edge-anchored, maximized, no-look thumb reach. */
  immersive?: boolean;
};

type MovementStyle = "stick" | "dpad" | "swipe";

const MOVEMENT_STYLES: ReadonlyArray<{ id: MovementStyle; label: string; icon: typeof Gamepad2 }> = [
  { id: "stick", label: "Analog", icon: Gamepad2 },
  { id: "dpad", label: "D-Pad", icon: Hand },
  { id: "swipe", label: "Swipe", icon: MoveDiagonal },
];

/** Base geometry (px) at scale 1.0; the user's size preference multiplies these. */
const BASE_CONTROL_PX = 132;
const BASE_FIRE_PX = 92;
const IMMERSIVE_ACTION_TOP_GAP_PX = 16;
const IMMERSIVE_ACTION_BOTTOM_OFFSET_PX = 40;
const ACTION_CONTROL_STACK_GAP_PX = 32;

export const VirtualJoystick = ({
  port,
  onSetPort,
  heldInputs,
  onHeldInputsChange,
  autofireEnabled,
  onAutofireEnabledChange,
  autofireRateHz,
  onAutofireRateHzChange,
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
      capturePointerBestEffort(zone, event.pointerId, "stick");
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
      applyDirections(resolveDragDirections(dx, dy, radius));
    },
    [applyDirections],
  );

  const releaseStick = useCallback(() => {
    activePointerIdRef.current = null;
    originRef.current = null;
    setStickOffset({ x: 0, y: 0 });
    applyDirections([]);
  }, [applyDirections]);

  // HARD15-005: switching movement style unmounts the outgoing control before
  // its own pointer-up can fire, so a held direction would otherwise stay
  // pressed on the device with an unbounded window. Strip only the four
  // directions (fire, held via the always-visible fire button, survives) and
  // skip the call entirely when nothing was held, to avoid a redundant flush.
  const releaseHeldDirections = useCallback(() => {
    const next = new Set(heldInputs);
    let removedAny = false;
    (["up", "down", "left", "right"] as const).forEach((direction) => {
      if (next.delete(direction)) removedAny = true;
    });
    if (removedAny) onHeldInputsChange(next);
  }, [heldInputs, onHeldInputsChange]);

  const handleMovementStyleChange = useCallback(
    (id: MovementStyle) => {
      if (id !== movementStyle) {
        releaseHeldDirections();
        // A mid-drag switch must not leave a stale gesture behind on the
        // control being switched away from.
        activePointerIdRef.current = null;
        originRef.current = null;
        directionsRef.current = [];
        setStickOffset({ x: 0, y: 0 });
      }
      setMovementStyle(id);
    },
    [movementStyle, releaseHeldDirections],
  );

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
      onPointerDown={(event) => {
        capturePointerBestEffort(event.currentTarget, event.pointerId, "fire button");
        setFireHeld("fire", true);
      }}
      onPointerUp={() => setFireHeld("fire", false)}
      onPointerCancel={() => setFireHeld("fire", false)}
    >
      FIRE
    </Button>
  );

  const autofireToggle = (
    <div
      className="flex flex-col items-center gap-2 rounded-3xl bg-background/90 px-3 py-2 text-center text-sm shadow-lg backdrop-blur-sm"
      data-testid="remote-input-autofire-toggle"
    >
      {/* HARD16-008: the same horizontal Switch + label pattern as the Port
          toggle, so the two read as siblings (the card + rate slider stay). */}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <Switch
          checked={autofireEnabled}
          onCheckedChange={onAutofireEnabledChange}
          disabled={disabled}
          data-testid="remote-input-autofire-switch"
        />
        Autofire
      </label>
      <div className="flex w-24 items-center gap-1.5" data-testid="remote-input-autofire-rate">
        <Slider
          value={[autofireRateHz]}
          min={MIN_AUTOFIRE_RATE_HZ}
          max={MAX_AUTOFIRE_RATE_HZ}
          step={1}
          disabled={disabled}
          onValueChange={([value]) => onAutofireRateHzChange(value)}
          aria-label="Autofire rate"
          data-testid="remote-input-autofire-rate-slider"
        />
        <span className="w-7 shrink-0 text-right text-xs tabular-nums" data-testid="remote-input-autofire-rate-label">
          {autofireRateHz}/s
        </span>
      </div>
    </div>
  );

  const portToggle = (
    <label className="flex items-center gap-2 text-sm" data-testid="remote-input-port-toggle">
      <Switch
        checked={port === 2}
        onCheckedChange={(checked) => onSetPort(checked ? 2 : 1)}
        disabled={disabled}
        data-testid="remote-input-port-switch"
      />
      Port {port}
    </label>
  );

  return (
    <div className={cn("flex flex-col gap-3", immersive && "h-full")} data-testid="remote-input-virtual-joystick">
      {disabled ? (
        <p
          className="flex items-center justify-center gap-1.5 px-4 text-center text-sm text-muted-foreground"
          data-testid="remote-input-joystick-unavailable-hint"
        >
          <AlertTriangle className="h-4 w-4" /> {disabledHint}
        </p>
      ) : null}

      {/* Secondary settings stay away from the constant-use action zone below.
          Game mode hides the movement-style selector, keeps the port swap on the
          left rail, and lifts Autofire onto its own control just above FIRE.
          HARD16-008: this chrome row gets the standard gutter; the action zone
          below stays edge-to-edge. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4">
        {portToggle}
        {!immersive ? (
          <div className="flex items-center gap-1.5" data-testid="remote-input-movement-style-toggle">
            {MOVEMENT_STYLES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                size="sm"
                variant={movementStyle === id ? "default" : "secondary"}
                disabled={disabled}
                data-testid={`remote-input-movement-style-${id}`}
                onClick={() => handleMovementStyleChange(id)}
              >
                <Icon className="mr-1.5 h-4 w-4" /> {label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Action zone: big directional control + big FIRE. In immersive mode the
          controls stay edge-anchored for no-look thumb reach with extra vertical
          clearance from both the top controls and the footer. */}
      <div
        className={cn("flex items-end justify-between gap-4", immersive && "relative min-h-0 flex-1")}
        style={
          immersive
            ? {
                paddingTop: IMMERSIVE_ACTION_TOP_GAP_PX,
              }
            : undefined
        }
      >
        <div
          className={cn(immersive && "absolute left-1")}
          style={immersive ? { bottom: IMMERSIVE_ACTION_BOTTOM_OFFSET_PX } : undefined}
        >
          {movementControl}
        </div>
        <div
          className={cn("flex items-end", immersive && "absolute right-1")}
          style={
            immersive ? { minHeight: controlPx, bottom: IMMERSIVE_ACTION_BOTTOM_OFFSET_PX } : { minHeight: controlPx }
          }
        >
          <div className="flex flex-col-reverse items-center" style={{ gap: ACTION_CONTROL_STACK_GAP_PX }}>
            {fireButton}
            {autofireToggle}
          </div>
        </div>
      </div>
    </div>
  );
};
