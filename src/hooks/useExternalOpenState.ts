/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, useSyncExternalStore } from "react";

/**
 * Whether a sheet is open, held outside the component that renders the button which opens it.
 *
 * Opening a sheet from a `useState` in the Play page re-rendered the whole page first: opening the Liked
 * Tunes sheet took 145 ms of script time in the pointer handler on the handset. With the open flag here,
 * only the sheet's own host component subscribes, so the page is not rendered again.
 */
export type ExternalOpenState = {
  isOpen: () => boolean;
  set: (open: boolean) => void;
  subscribe: (listener: () => void) => () => void;
};

export const createExternalOpenState = (initial = false): ExternalOpenState => {
  let open = initial;
  const listeners = new Set<() => void>();
  return {
    isOpen: () => open,
    set: (next) => {
      if (next === open) return;
      open = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/** One state for the lifetime of the calling component. */
export const useExternalOpenState = (initial = false): ExternalOpenState =>
  useState(() => createExternalOpenState(initial))[0];

export const useIsExternallyOpen = (state: ExternalOpenState): boolean =>
  useSyncExternalStore(state.subscribe, state.isOpen);
