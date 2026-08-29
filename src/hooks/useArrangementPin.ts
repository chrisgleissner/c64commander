/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { isAnyOverlayOpen } from "@/lib/input/eventTargets";
import { TOUR_ACTIVE_ATTRIBUTE } from "@/lib/tour/tourState";

/**
 * True while something is on top of the page: a dialog, a sheet, the search overlay, or the tour
 * (spec.md section 7.3). Home freezes its arrangement while this holds, so the page cannot reflow
 * under whatever the user is looking at.
 *
 * A MutationObserver over the document rather than a shared store: the overlays that matter are
 * mounted by several different owners — Home's own sheets, the app root's search overlay and device
 * switcher, Radix's portals — and no one of them already knows about the others.
 */
export const useArrangementPin = (): boolean => {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const evaluate = () =>
      setPinned(isAnyOverlayOpen() || document.documentElement.hasAttribute(TOUR_ACTIVE_ATTRIBUTE));
    evaluate();
    const observer = new MutationObserver(evaluate);
    observer.observe(document.body, { childList: true, subtree: true });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [TOUR_ACTIVE_ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);

  return pinned;
};
