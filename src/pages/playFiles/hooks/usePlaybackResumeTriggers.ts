/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";

/**
 * Triggers a callback when the app likely resumed after being backgrounded/locked.
 *
 * This intentionally wires multiple signals because Android/WebView behavior can vary
 * across versions and OEM power management.
 */
export const usePlaybackResumeTriggers = (onResume: () => void) => {
  const lastResumeSignalAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const emitResumeOnce = () => {
      const now = Date.now();
      const lastResumeSignalAt = lastResumeSignalAtRef.current;
      if (lastResumeSignalAt !== null && now - lastResumeSignalAt < 250) return;
      lastResumeSignalAtRef.current = now;
      onResume();
    };

    const onVisible = () => {
      if (document.hidden) return;
      emitResumeOnce();
    };
    const onFocus = () => {
      emitResumeOnce();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, [onResume]);
};
