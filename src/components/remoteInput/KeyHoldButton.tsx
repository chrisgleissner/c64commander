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
          onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
            onHoldRelease();
            // Normally onClick's own guard below resets the ref right after
            // this (pointerup -> click is synchronous for a release still
            // over the button). But pointer capture redirects pointerup/
            // pointercancel HERE even when a finger dragged OFF the button
            // first - and in that case the browser does not synthesize a
            // click at all, so onClick's reset never runs, leaving the ref
            // stuck `true` and silently swallowing the NEXT activation
            // (including a keyboard/assistive-tech Enter/Space, which always
            // goes through onClick). Detect that case geometrically (no
            // click is coming if the release lands outside the button) and
            // reset immediately instead of guessing with a timer.
            const rect = event.currentTarget.getBoundingClientRect();
            const releasedInsideBounds =
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom;
            if (!releasedInsideBounds) handledByPointerRef.current = false;
          },
          onPointerCancel: () => {
            // A genuine cancel never gets a click either (same reasoning as
            // the out-of-bounds case above).
            handledByPointerRef.current = false;
            onHoldRelease();
          },
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
