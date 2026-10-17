/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getInputModality } from "./inputModality";
import { focusRingElement } from "./ringDom";

export interface RingFocusSource {
  readonly controller: { readonly focus: { current(): { readonly id: string } | null } };
  readonly engine: { flushPendingRefresh(): void; elementForId(id: string): HTMLElement | null };
}

/**
 * Gives DOM focus back to the ring's current stop once a surface that held it has closed.
 *
 * An overlay that owns its own keys (the search field) takes DOM focus when it opens and drops it to the
 * body when it unmounts. The highlight stays on the stop the user left, but the next key then starts from
 * the body, and a later scan can move the ring on from there. Returns whether focus was moved.
 */
export const restoreRingFocus = (ring: RingFocusSource): boolean => {
  if (getInputModality() !== "key-navigation") return false;
  const holder = document.activeElement;
  if (holder && holder !== document.body) return false;
  ring.engine.flushPendingRefresh();
  const currentId = ring.controller.focus.current()?.id;
  const element = currentId ? ring.engine.elementForId(currentId) : null;
  if (!element?.isConnected) return false;
  focusRingElement(element);
  return true;
};
