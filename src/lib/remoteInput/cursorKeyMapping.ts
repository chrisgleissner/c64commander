/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MachineInputKeyboardEvent, MachineInputTransition } from "@/lib/c64api";

export type CursorDirection = "up" | "down" | "left" | "right";

/**
 * The real C64 keyboard has exactly two physical cursor keys, each shared by
 * two directions via Shift: `cursor_left_right` (unshifted = right, shifted =
 * left) and `cursor_up_down` (unshifted = down, shifted = up). There is no
 * separate "cursor up" or "cursor left" key in the `machine:input` enum.
 */
export const cursorDirectionToKeyboardInputEvent = (
  direction: CursorDirection,
  transition: MachineInputTransition = "tap",
): MachineInputKeyboardEvent => {
  switch (direction) {
    case "right":
      return { kind: "keyboard", inputs: ["cursor_left_right"], transition };
    case "left":
      return { kind: "keyboard", inputs: ["cursor_left_right", "left_shift"], transition };
    case "down":
      return { kind: "keyboard", inputs: ["cursor_up_down"], transition };
    case "up":
      return { kind: "keyboard", inputs: ["cursor_up_down", "left_shift"], transition };
  }
};

/**
 * PETSCII cursor-control byte for the kernal keyboard-buffer fallback tier
 * (devices/firmware without `machine:input`). Standard C64 PETSCII codes.
 */
const CURSOR_DIRECTION_TO_PETSCII: Record<CursorDirection, number> = {
  down: 0x11,
  right: 0x1d,
  up: 0x91,
  left: 0x9d,
};

export const cursorKeyToPetscii = (direction: CursorDirection): number => CURSOR_DIRECTION_TO_PETSCII[direction];

/** PETSCII RETURN (0x0d) and INST/DEL (0x14), for the same fallback tier. */
export const PETSCII_RETURN = 0x0d;
export const PETSCII_INST_DEL = 0x14;
