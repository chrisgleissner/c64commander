/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TraceEvent } from "@/lib/tracing/types";

// §7.3 — the longest window any trace-derived health rule reads.
export const HEALTH_CURRENT_WINDOW_MS = 5 * 60 * 1000;

const isOlderThanWindow = (event: TraceEvent, nowMs: number) =>
  nowMs - Date.parse(event.timestamp) > HEALTH_CURRENT_WINDOW_MS;

/**
 * Returns the newest events that the windowed health rules can still see. The trace store appends in
 * time order, so the scan walks back from the newest event and stops at the first one older than the
 * window; its cost follows the window's size, not the store's. An event without a parseable
 * timestamp never ends the scan, because the rules themselves decide what to do with it.
 */
export const selectHealthWindowEvents = <T extends TraceEvent>(events: readonly T[], nowMs: number): T[] => {
  let start = events.length;
  while (start > 0 && !isOlderThanWindow(events[start - 1], nowMs)) {
    start -= 1;
  }
  return events.slice(start);
};
