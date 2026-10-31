/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";

let current = false;
const listeners = new Set<() => void>();

/** Whether the most recent launch plays on this phone although the song needs ROMs the phone lacks. */
export const setMaySoundWrong = (value: boolean): void => {
  if (current === value) return;
  current = value;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useMaySoundWrong = (): boolean => useSyncExternalStore(subscribe, () => current);
