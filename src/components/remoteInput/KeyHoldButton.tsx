/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef } from "react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { capturePointerBestEffort } from "@/lib/remoteInput/pointerCapture";

/**
 * Wraps the plain Button with the DirectionPad's pointer/click split: a real
 * pointerdown/up drives `onHoldPress`/`onHoldRelease` (and captures the
 * pointer so a dragging finger still delivers pointerup to this element); a
 * keypad/focus-ring `.click()` with no preceding pointerdown falls through to
 * `onTap` instead, so assistive-tech activation stays a single atomic action.
 * When `onHoldPress`/`onHoldRelease` are omitted, every interaction goes
 * through `onTap` — used by keys with no hold concept (SHIFT LOCK, cursor
 * keys, which keep their own repeat-on-hold elsewhere).
 */
export const KeyHoldButton = ({
  onHoldPress,
  onHoldRelease,
  onTap,
  ...buttonProps
}: ComponentProps<typeof Button> & {
  onHoldPress?: () => void;
  onHoldRelease?: () => void;
  onTap: () => void;
}) => {
  const handledByPointerRef = useRef(false);
  const holdHandlers =
    onHoldPress && onHoldRelease
      ? {
          onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
            capturePointerBestEffort(event.currentTarget, event.pointerId, "keyboard hold key");
            handledByPointerRef.current = true;
            onHoldPress();
          },
          onPointerUp: () => onHoldRelease(),
          onPointerCancel: () => onHoldRelease(),
        }
      : {};
  return (
    <Button
      {...buttonProps}
      {...holdHandlers}
      onClick={() => {
        if (handledByPointerRef.current) {
          handledByPointerRef.current = false;
          return;
        }
        onTap();
      }}
    />
  );
};
