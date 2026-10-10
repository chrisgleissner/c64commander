/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";

/** Run `run` once when the clock reaches `atMs`, at once if it already has; a new `atMs` sets it again, `null` never. */
export const useRunAtTime = (run: () => void, atMs: number | null) => {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (atMs === null) return;
    let timer: number | undefined;
    // A timer can fire a millisecond before the clock it was set against says it is due.
    const fireWhenDue = () => {
      const remainingMs = atMs - Date.now();
      if (remainingMs > 0) {
        timer = window.setTimeout(fireWhenDue, remainingMs);
        return;
      }
      runRef.current();
    };
    timer = window.setTimeout(fireWhenDue, Math.max(0, atMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [atMs]);
};
