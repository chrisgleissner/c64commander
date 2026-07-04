/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import type { JoystickInputName } from "@/lib/c64api";

export type VirtualDPadProps = {
  heldInputs: HeldJoystickInputs;
  onHeldInputsChange: (next: HeldJoystickInputs) => void;
  disabled?: boolean;
};

const DPAD_CELLS: ReadonlyArray<{
  key: string;
  inputs: JoystickInputName[];
  icon: typeof ArrowUp;
  gridArea: string;
} | null> = [
  { key: "up-left", inputs: ["up", "left"], icon: ArrowUpLeft, gridArea: "ul" },
  { key: "up", inputs: ["up"], icon: ArrowUp, gridArea: "u" },
  { key: "up-right", inputs: ["up", "right"], icon: ArrowUpRight, gridArea: "ur" },
  { key: "left", inputs: ["left"], icon: ArrowLeft, gridArea: "l" },
  null,
  { key: "right", inputs: ["right"], icon: ArrowRight, gridArea: "r" },
  { key: "down-left", inputs: ["down", "left"], icon: ArrowDownLeft, gridArea: "dl" },
  { key: "down", inputs: ["down"], icon: ArrowDown, gridArea: "d" },
  { key: "down-right", inputs: ["down", "right"], icon: ArrowDownRight, gridArea: "dr" },
];

/**
 * A discrete 8-way tap-and-hold D-pad: an alternative touch style to the
 * relative thumbstick for users who prefer precise directional buttons over
 * analog dragging. Each cell composes with the held set the same way the
 * fire button does, so it never disturbs directions/fire held via any other
 * input method (physical D-pad, keyboard arrows, swipe).
 */
export const VirtualDPad = ({ heldInputs, onHeldInputsChange, disabled = false }: VirtualDPadProps) => {
  const setCellHeld = useCallback(
    (inputs: JoystickInputName[], held: boolean) => {
      if (disabled) return;
      const next = new Set(heldInputs);
      if (held) inputs.forEach((input) => next.add(input));
      else inputs.forEach((input) => next.delete(input));
      onHeldInputsChange(next);
    },
    [disabled, heldInputs, onHeldInputsChange],
  );

  const isCellHeld = (inputs: JoystickInputName[]) => inputs.every((input) => heldInputs.has(input));

  return (
    <div
      className="grid h-32 w-32 grid-cols-3 grid-rows-3 gap-1"
      data-testid="remote-input-virtual-dpad"
      style={{ gridTemplateAreas: '"ul u ur" "l . r" "dl d dr"' }}
    >
      {DPAD_CELLS.map((cell, index) =>
        cell ? (
          <Button
            key={cell.key}
            size="icon"
            variant={isCellHeld(cell.inputs) ? "default" : "secondary"}
            className={cn("h-full w-full")}
            style={{ gridArea: cell.gridArea }}
            data-testid={`remote-input-dpad-${cell.key}`}
            data-pressed={isCellHeld(cell.inputs) ? "true" : "false"}
            disabled={disabled}
            onPointerDown={() => setCellHeld(cell.inputs, true)}
            onPointerUp={() => setCellHeld(cell.inputs, false)}
            onPointerCancel={() => setCellHeld(cell.inputs, false)}
          >
            <cell.icon className="h-4 w-4" />
          </Button>
        ) : (
          <div key={`spacer-${index}`} style={{ gridArea: "." }} />
        ),
      )}
    </div>
  );
};
