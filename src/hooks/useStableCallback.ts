/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { addLog } from "@/lib/logging";

type Callback<Args extends unknown[]> = (...args: Args) => void;

/**
 * A function with a fixed identity that always calls the latest `callback`; undefined stays undefined.
 * A timer can still hold the wrapper after the callback is withdrawn; that call does nothing and logs a warning.
 */
export function useStableCallback<Args extends unknown[]>(callback: Callback<Args>, name: string): Callback<Args>;
export function useStableCallback<Args extends unknown[]>(
  callback: Callback<Args> | undefined,
  name: string,
): Callback<Args> | undefined;
export function useStableCallback<Args extends unknown[]>(
  callback: Callback<Args> | undefined,
  name: string,
): Callback<Args> | undefined {
  const latest = useRef(callback);
  const warnedWithdrawn = useRef(false);
  useLayoutEffect(() => {
    latest.current = callback;
    if (callback) warnedWithdrawn.current = false;
  });
  const stable = useCallback(
    (...args: Args) => {
      const current = latest.current;
      if (current) {
        current(...args);
        return;
      }
      if (warnedWithdrawn.current) return;
      warnedWithdrawn.current = true;
      addLog("warn", "Callback called after it was withdrawn; ignoring the call", {
        callback: name,
        stack: new Error("withdrawn callback").stack,
      });
    },
    [name],
  );
  return callback ? stable : undefined;
}
