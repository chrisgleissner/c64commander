/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The first-run tour, recorded as already taken.
 *
 * Its own module because playwright.config.ts reads it to seed every browser context, and the config
 * is loaded before any spec: importing it from uiMocks.ts would pull that file's Playwright helpers
 * and mock fixtures into config evaluation.
 */
export const TOUR_STATE_KEY = "c64u_tour_state:v1";

export const TOUR_TAKEN_STATE = JSON.stringify({
  completedAt: 1735689600000,
  skippedAt: null,
  lastStepId: null,
  deviceStepsPending: false,
});
