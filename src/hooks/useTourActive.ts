/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { TOUR_ACTIVE_ATTRIBUTE } from "@/lib/tour/tourState";

/**
 * True while the tour is running, read from the attribute the driver sets on <html>.
 *
 * An attribute rather than a context: the two readers are the swipe layer and Home's arrangement
 * pin, and neither sits under the tour in the tree — putting a provider above both would mean
 * wrapping the whole app for a flag that is off almost all of the time.
 */
export const useTourActive = (): boolean => {
  const [active, setActive] = useState(
    () => typeof document !== "undefined" && document.documentElement.hasAttribute(TOUR_ACTIVE_ATTRIBUTE),
  );

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const evaluate = () => setActive(document.documentElement.hasAttribute(TOUR_ACTIVE_ATTRIBUTE));
    evaluate();
    const observer = new MutationObserver(evaluate);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [TOUR_ACTIVE_ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);

  return active;
};
