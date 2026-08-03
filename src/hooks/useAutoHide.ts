/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface AutoHide {
  visible: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  /** Props for the summoned element: any interaction with it restarts its idle timer. */
  keepAliveProps: {
    onPointerDown: () => void;
    onKeyDown: () => void;
    onFocusCapture: () => void;
  };
}

/**
 * A transient overlay that puts itself away again after an IDLE period, so nothing a user
 * summons over the picture can be left covering it.
 *
 * Idle, not elapsed: a toolbar the user deliberately asked for and is still reaching across
 * must not vanish underneath their thumb. {@link AutoHide.keepAliveProps} restarts the timer
 * on every interaction, so it stays for as long as it is being used and goes away once it
 * is not. Used by Game Mode's restored chrome and its quick-keys row, which is why both
 * behave identically without either owning a timer of its own.
 */
export const useAutoHide = (durationMs: number): AutoHide => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    setVisible(false);
  }, [clear]);

  const show = useCallback(() => {
    clear();
    setVisible(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setVisible(false);
    }, durationMs);
  }, [clear, durationMs]);

  const toggle = useCallback(() => {
    if (timerRef.current || visible) hide();
    else show();
  }, [visible, hide, show]);

  useEffect(() => clear, [clear]);

  const keepAliveProps = useMemo(() => ({ onPointerDown: show, onKeyDown: show, onFocusCapture: show }), [show]);

  return { visible, show, hide, toggle, keepAliveProps };
};
