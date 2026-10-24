/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useLayoutEffect, useRef } from "react";

/** A function with a fixed identity that always calls the latest `callback`; undefined stays undefined. */
export const useStableCallback = <Args extends unknown[], Result>(
  callback: ((...args: Args) => Result) | undefined,
): ((...args: Args) => Result) | undefined => {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  const stable = useCallback((...args: Args): Result => (latest.current as (...args: Args) => Result)(...args), []);
  return callback ? stable : undefined;
};
