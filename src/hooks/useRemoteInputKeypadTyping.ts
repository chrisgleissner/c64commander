/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { resolveSemanticAction, digitForAction } from "@/lib/input/keyEvent";
import { resolveInputProfile } from "@/lib/input/profiles";
import { applySemanticAction, commitPending, createT9State, resolveT9Config, type T9State } from "@/lib/input/t9";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";

export interface RemoteInputKeypadTypingOptions {
  /** Types one character on the C64 as a press and release. */
  sendChar: (char: string) => void;
  sendCursor: (direction: CursorDirection) => void;
}

export interface RemoteInputKeypadTyping {
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Drops a letter still being chosen and starts the next one afresh. */
  reset: () => void;
}

const CURSOR_BY_ACTION: Partial<Record<string, CursorDirection>> = {
  dpadUp: "up",
  dpadDown: "down",
  dpadLeft: "left",
  dpadRight: "right",
};

const committedLength = (state: T9State): number => (state.pending ? state.cursor - 1 : state.cursor);

/**
 * The physical keypad as the C64's keyboard, for Remote Input's Keys mode.
 *
 * Multi-tap is the same engine and timing as the app's text fields. A letter reaches the C64 once
 * it is chosen: when the multi-tap timeout passes, another key is pressed, or OK or a direction
 * is pressed. Every key is sent as a press and release, so nothing can stay held on the C64. OK is
 * RETURN, the D-pad is the cursor keys, `#` switches between letters and digits.
 */
export const useRemoteInputKeypadTyping = ({
  sendChar,
  sendCursor,
}: RemoteInputKeypadTypingOptions): RemoteInputKeypadTyping => {
  const keymap = resolveInputProfile("keypad");
  const config = useMemo(
    () => resolveT9Config({ multiTapTimeoutMs: keymap.timing.multiTapTimeoutMs }),
    [keymap.timing.multiTapTimeoutMs],
  );
  const stateRef = useRef<T9State>(createT9State());
  const sentRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const sendCommitted = useCallback(() => {
    const state = stateRef.current;
    while (sentRef.current < committedLength(state)) {
      sendChar(state.text[sentRef.current]);
      sentRef.current += 1;
    }
  }, [sendChar]);

  const flush = useCallback(() => {
    clearTimer();
    stateRef.current = commitPending(stateRef.current);
    sendCommitted();
    stateRef.current = createT9State({ mode: stateRef.current.mode });
    sentRef.current = 0;
  }, [sendCommitted]);

  const reset = useCallback(() => {
    clearTimer();
    stateRef.current = createT9State({ mode: stateRef.current.mode });
    sentRef.current = 0;
  }, []);

  useEffect(() => clearTimer, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const action = resolveSemanticAction(keymap, event);
      if (!action) return;
      if (digitForAction(action) !== null || action === "star" || action === "hash") {
        event.preventDefault();
        if (event.repeat) return;
        stateRef.current = applySemanticAction(stateRef.current, action, performance.now(), config);
        sendCommitted();
        clearTimer();
        if (stateRef.current.pending) timerRef.current = setTimeout(flush, config.multiTapTimeoutMs);
        return;
      }
      if (action === "center" || action === "enter") {
        event.preventDefault();
        if (event.repeat) return;
        flush();
        sendChar("\r");
        return;
      }
      const direction = CURSOR_BY_ACTION[action];
      if (direction) {
        event.preventDefault();
        flush();
        sendCursor(direction);
      }
    },
    [keymap, config, sendCommitted, flush, sendChar, sendCursor],
  );

  return { handleKeyDown, reset };
};
