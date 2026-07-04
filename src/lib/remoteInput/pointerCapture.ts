/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog, buildErrorLogDetails } from "@/lib/logging";

/**
 * Lead F2: touch gets implicit pointer capture, but mouse does not - a
 * hold-and-drag-off gesture (press FIRE/a D-pad cell, drag the pointer off
 * without releasing, then release) never delivers the `pointerup` to the
 * element that started the hold, leaving it stuck held on desktop web. Call
 * this from `onPointerDown` on every hold-style control (mirrors the stick
 * zone's original pattern). Best-effort: some older WebViews lack support,
 * so a failure degrades (the hold still mostly works via ordinary pointer
 * events while the finger stays over the control) rather than throwing and
 * aborting the whole gesture.
 */
export const capturePointerBestEffort = (target: Element, pointerId: number, logContext: string): void => {
  try {
    target.setPointerCapture(pointerId);
  } catch (error) {
    addLog(
      "warn",
      `Remote input ${logContext} pointer capture unavailable`,
      buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { pointerId }),
    );
  }
};
