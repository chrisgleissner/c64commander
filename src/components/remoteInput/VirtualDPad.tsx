/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef } from "react";
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
  /**
   * HARD21-006: the session's release-all epoch (useRemoteInputSession.
   * releaseAllEpoch). When it changes, this pad resets its pressed-cell refs.
   */
  releaseAllEpoch?: number;
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
export const VirtualDPad = ({
  heldInputs,
  onHeldInputsChange,
  disabled = false,
  sizePx = 128,
  releaseAllEpoch,
}: VirtualDPadProps) => {
  // HARD19-003: cells overlap on axes (the "up" cell and the "up-right" cell
  // both contribute "up"), so a blind per-cell delete on release dropped a
  // direction another finger still physically held — a released second touch
  // freed the first finger's axis mid-game. Track which CELLS this pad currently
  // holds and rebuild its axis contribution from their union each change,
  // mirroring RemoteInputSheet.recomputePhysicalHeldSet: only remove inputs THIS
  // pad contributed last time and no longer holds, so other still-pressed cells
  // (and any other input source, e.g. a touch-held FIRE) survive untouched.
  const pressedCellKeysRef = useRef<Set<string>>(new Set());
  const previousContributionRef = useRef<Set<JoystickInputName>>(new Set());

  const applyPressedCells = useCallback(() => {
    const contribution = new Set<JoystickInputName>();
    pressedCellKeysRef.current.forEach((key) => {
      DPAD_CELLS.find((cell) => cell?.key === key)?.inputs.forEach((input) => contribution.add(input));
    });
    const next = new Set(heldInputs);
    previousContributionRef.current.forEach((input) => {
      if (!contribution.has(input)) next.delete(input);
    });
    contribution.forEach((input) => next.add(input));
    previousContributionRef.current = contribution;
    onHeldInputsChange(next);
  }, [heldInputs, onHeldInputsChange]);

  const setCellHeld = useCallback(
    (cellKey: string, held: boolean) => {
      if (disabled) return;
      // A release for a cell that never registered a press (e.g. a pointer that
      // slid on from a grid gap with no matching pointerdown) is a harmless
      // no-op here, so it can no longer free another finger's axis.
      if (held) pressedCellKeysRef.current.add(cellKey);
      else pressedCellKeysRef.current.delete(cellKey);
      applyPressedCells();
    },
    [disabled, applyPressedCells],
  );

  // HARD21-006: releaseAll (panic button, sheet close, backgrounding, mode
  // switch) clears the SESSION's shared joystick held set directly, but has no
  // channel into this pad's own pressed-cell/contribution refs. If the user taps
  // Release All while a cell's pointer is still down (no pointerup/pointercancel),
  // pressedCellKeysRef/previousContributionRef keep the stale cell — and the next
  // cell press rebuilds the contribution as the UNION with the phantom-held one,
  // re-asserting a direction panic just cleared (SOCD / stuck direction mid-game).
  // Reset both refs on the EXPLICIT releaseAllEpoch signal — NOT on an empty
  // shared set: a physical key and a D-pad cell can hold the SAME direction, so
  // releasing the physical source can momentarily empty the shared set while this
  // pad's pointer is still down; clearing then would drop the live hold (it could
  // no longer recover on the next press). Clearing already-empty refs on mount is
  // a harmless no-op. Pure ref clears only (no onHeldInputsChange/setState).
  useEffect(() => {
    pressedCellKeysRef.current.clear();
    previousContributionRef.current.clear();
  }, [releaseAllEpoch]);

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
          onPressStart: () => setCellHeld(cell.key, true),
          onPressEnd: () => setCellHeld(cell.key, false),
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
