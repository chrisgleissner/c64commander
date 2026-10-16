/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function whose identity never changes and that always calls the latest `callback`.
 *
 * For a callback handed to something memoised on it, when the callback itself is rebuilt on state
 * the memoised thing never reads: the playlist's start function changed on every mute, and each
 * change rebuilt and re-rendered every playlist row.
 */
export const useLatestCallback = <Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): ((...args: Args) => Result) => {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
};
