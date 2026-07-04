/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ComponentType } from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { capturePointerBestEffort } from "@/lib/remoteInput/pointerCapture";

/**
 * A purely presentational directional pad: a size-fixed 3×3 grid of cells laid
 * out by CSS grid areas. It has NO built-in joystick or keyboard semantics —
 * each cell simply renders what it is told and calls back on interaction:
 *
 * - hold  — `onPressStart`/`onPressEnd` (pointer down/up/cancel). The joystick
 *           D-pad uses this to add/remove a held direction; the keyboard Cursor
 *           Pad uses it to auto-repeat a cursor key while held.
 * - tap   — `onActivate` (click). A cell may set this ALONGSIDE the hold
 *           callbacks: a real pointer press is handled by `onPressStart` and the
 *           trailing synthetic click is suppressed, so `onActivate` fires only
 *           for a keypad/focus-ring `.click()` (which dispatches no pointerdown),
 *           keeping the cell reachable by keypad without double-acting on touch.
 *
 * Because behaviour lives entirely in the caller-supplied callbacks, the same
 * visual pad serves the Joystick tab and the Type tab without ever conflating
 * their actions (see VirtualDPad vs CursorPad).
 */
export type DirectionPadCell = {
  /** Grid-area name; must match a token in `gridTemplateAreas`. */
  gridArea: string;
  /** React key + suffix source. */
  key: string;
  testId: string;
  ariaLabel: string;
  /** Icon OR text label (text wins if both are given). */
  icon?: ComponentType<{ style?: React.CSSProperties; className?: string }>;
  label?: string;
  pressed?: boolean;
  disabled?: boolean;
  /** Hold semantics. */
  onPressStart?: () => void;
  onPressEnd?: () => void;
  /** Tap semantics. */
  onActivate?: () => void;
};

export type DirectionPadProps = {
  cells: ReadonlyArray<DirectionPadCell | null>;
  /** Overall square size of the pad, in px. */
  sizePx: number;
  /** CSS `grid-template-areas` string (e.g. '"ul u ur" "l . r" "dl d dr"'). */
  gridTemplateAreas: string;
  testId: string;
  className?: string;
};

const DirectionPadButton = ({
  cell,
  iconPx,
  labelFontPx,
}: {
  cell: DirectionPadCell;
  iconPx: number;
  labelFontPx: number;
}) => {
  // True once a real pointer press has driven onPressStart, so the trailing
  // synthetic click is skipped; a keypad/focus-ring `.click()` (no pointerdown)
  // leaves it false and falls through to the single-shot onActivate.
  const handledByPointerRef = useRef(false);

  return (
    <Button
      size="icon"
      variant={cell.pressed ? "default" : "secondary"}
      className="h-full w-full"
      style={{ gridArea: cell.gridArea }}
      data-testid={cell.testId}
      data-pressed={cell.pressed ? "true" : "false"}
      aria-label={cell.ariaLabel}
      disabled={cell.disabled}
      onPointerDown={(event) => {
        if (!cell.onPressStart) return;
        capturePointerBestEffort(event.currentTarget, event.pointerId, "d-pad cell");
        handledByPointerRef.current = true;
        cell.onPressStart();
      }}
      onPointerUp={cell.onPressEnd}
      onPointerCancel={cell.onPressEnd}
      onClick={() => {
        if (handledByPointerRef.current) {
          handledByPointerRef.current = false;
          return;
        }
        cell.onActivate?.();
      }}
    >
      {cell.label ? (
        <span style={{ fontSize: labelFontPx, fontWeight: 600, whiteSpace: "nowrap" }}>{cell.label}</span>
      ) : cell.icon ? (
        <cell.icon style={{ width: iconPx, height: iconPx }} />
      ) : null}
    </Button>
  );
};

export const DirectionPad = ({ cells, sizePx, gridTemplateAreas, testId, className }: DirectionPadProps) => {
  const iconPx = Math.max(16, Math.round(sizePx / 6));
  const labelFontPx = Math.max(11, Math.round(sizePx / 9));

  return (
    <div
      className={cn("grid grid-cols-3 grid-rows-3 gap-1.5", className)}
      data-testid={testId}
      data-cell-size={Math.round(sizePx / 3)}
      style={{ width: sizePx, height: sizePx, gridTemplateAreas }}
    >
      {cells.map((cell, index) =>
        cell ? (
          <DirectionPadButton key={cell.key} cell={cell} iconPx={iconPx} labelFontPx={labelFontPx} />
        ) : (
          <div key={`spacer-${index}`} style={{ gridArea: "." }} />
        ),
      )}
    </div>
  );
};
