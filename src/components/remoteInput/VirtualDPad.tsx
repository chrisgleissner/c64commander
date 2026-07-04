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
import { DirectionPad, type DirectionPadCell } from "@/components/remoteInput/DirectionPad";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import type { JoystickInputName } from "@/lib/c64api";

export type VirtualDPadProps = {
  heldInputs: HeldJoystickInputs;
  onHeldInputsChange: (next: HeldJoystickInputs) => void;
  disabled?: boolean;
  /** Overall square size of the 3x3 pad, in px (defaults to the compact 128px). */
  sizePx?: number;
};

const DPAD_CELLS: ReadonlyArray<{
  key: string;
  inputs: JoystickInputName[];
  icon: typeof ArrowUp;
  gridArea: string;
  ariaLabel: string;
} | null> = [
  { key: "up-left", inputs: ["up", "left"], icon: ArrowUpLeft, gridArea: "ul", ariaLabel: "Joystick up and left" },
  { key: "up", inputs: ["up"], icon: ArrowUp, gridArea: "u", ariaLabel: "Joystick up" },
  { key: "up-right", inputs: ["up", "right"], icon: ArrowUpRight, gridArea: "ur", ariaLabel: "Joystick up and right" },
  { key: "left", inputs: ["left"], icon: ArrowLeft, gridArea: "l", ariaLabel: "Joystick left" },
  null,
  { key: "right", inputs: ["right"], icon: ArrowRight, gridArea: "r", ariaLabel: "Joystick right" },
  {
    key: "down-left",
    inputs: ["down", "left"],
    icon: ArrowDownLeft,
    gridArea: "dl",
    ariaLabel: "Joystick down and left",
  },
  { key: "down", inputs: ["down"], icon: ArrowDown, gridArea: "d", ariaLabel: "Joystick down" },
  {
    key: "down-right",
    inputs: ["down", "right"],
    icon: ArrowDownRight,
    gridArea: "dr",
    ariaLabel: "Joystick down and right",
  },
];

/**
 * A discrete 8-way tap-and-hold D-pad: an alternative touch style to the
 * relative thumbstick for users who prefer precise directional buttons over
 * analog dragging. Each cell composes with the held set the same way the
 * fire button does, so it never disturbs directions/fire held via any other
 * input method (physical D-pad, keyboard arrows, swipe).
 *
 * The visual pad itself is the shared {@link DirectionPad}; VirtualDPad only
 * wires it to JOYSTICK hold semantics. The keyboard Cursor Pad wires the same
 * visual to keyboard cursor taps instead — the two never share action
 * semantics (see CursorPad).
 */
export const VirtualDPad = ({ heldInputs, onHeldInputsChange, disabled = false, sizePx = 128 }: VirtualDPadProps) => {
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

  const cells: ReadonlyArray<DirectionPadCell | null> = DPAD_CELLS.map((cell) =>
    cell
      ? {
          key: cell.key,
          testId: `remote-input-dpad-${cell.key}`,
          ariaLabel: cell.ariaLabel,
          icon: cell.icon,
          gridArea: cell.gridArea,
          pressed: isCellHeld(cell.inputs),
          disabled,
          onPressStart: () => setCellHeld(cell.inputs, true),
          onPressEnd: () => setCellHeld(cell.inputs, false),
        }
      : null,
  );

  return (
    <DirectionPad
      cells={cells}
      sizePx={sizePx}
      gridTemplateAreas='"ul u ur" "l . r" "dl d dr"'
      testId="remote-input-virtual-dpad"
    />
  );
};
