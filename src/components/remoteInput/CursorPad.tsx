/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { DirectionPad, type DirectionPadCell } from "@/components/remoteInput/DirectionPad";
import { vibrateTap } from "@/lib/remoteInput/haptics";
import { CURSOR_DIRECTIONS, CURSOR_KEY_META } from "@/lib/remoteInput/keyboardLayout";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";

export type CursorPadProps = {
  onCursor: (direction: CursorDirection) => void;
  /** Overall square size of the cross pad, in px. */
  sizePx: number;
};

const GRID_AREA: Record<CursorDirection, string> = { up: "u", down: "d", left: "l", right: "r" };

/**
 * The Type-tab keyboard CURSOR PAD: a large, visually-isolated cross of the
 * four C64 cursor-movement keys. It reuses the shared {@link DirectionPad}
 * visual (same component the Joystick D-pad uses) but wires it to KEYBOARD
 * cursor movement — one tap per press via `onCursor` — never joystick
 * directions. It contains ONLY the four cursor keys plus layout spacers; no
 * edit, modifier, function, RESTORE or RUN/STOP key is placed inside it, so a
 * shaky cursor tap can never land on a destructive or mode-changing key.
 */
export const CursorPad = ({ onCursor, sizePx }: CursorPadProps) => {
  const cells: ReadonlyArray<DirectionPadCell | null> = CURSOR_DIRECTIONS.map((direction) => ({
    key: direction,
    testId: CURSOR_KEY_META[direction].testId,
    ariaLabel: CURSOR_KEY_META[direction].ariaLabel,
    icon: CURSOR_KEY_META[direction].icon,
    gridArea: GRID_AREA[direction],
    onActivate: () => {
      vibrateTap(10);
      onCursor(direction);
    },
  }));

  return (
    <DirectionPad
      cells={cells}
      sizePx={sizePx}
      gridTemplateAreas='". u ." "l . r" ". d ."'
      testId="remote-input-cursor-pad"
    />
  );
};
