/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type AdvanceGuard = { trackInstanceId: number; autoFired: boolean };

/**
 * What the background watchdog finds after asking the Play page to advance.
 *
 * "in-flight" means the same tune is still on screen because another advance, usually the page's own timer firing at the
 * same moment, already claimed this track end and is still starting the next tune. That is normal, and the claim owns
 * the watchdog. "stuck" is the only outcome that means the advance did nothing.
 */
export type BackgroundAdvanceOutcome = "no-guard" | "moved-on" | "in-flight" | "stuck";

export const resolveBackgroundAdvanceOutcome = (
  expectedTrackInstanceId: number,
  nextGuard: AdvanceGuard | null,
): BackgroundAdvanceOutcome => {
  if (!nextGuard) return "no-guard";
  if (nextGuard.trackInstanceId !== expectedTrackInstanceId) return "moved-on";
  return nextGuard.autoFired ? "in-flight" : "stuck";
};

export const BACKGROUND_ADVANCE_LOG_MESSAGES = {
  "no-guard": "Cleared background auto-advance watchdog after auto next with no remaining guard",
  "in-flight": "Background auto-advance left to the advance already under way",
  stuck: "Background auto-advance did not move to a new track instance; cleared stale watchdog",
} as const;
