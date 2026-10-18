/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SemanticAction } from "./keyEvent";

export const PAGE_LOADING_STOP_ID = "page-loading";

const MOVEMENT_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>([
  "dpadUp",
  "dpadDown",
  "dpadLeft",
  "dpadRight",
]);

/**
 * Whether a direction key must wait because the ring stands on the loading placeholder. Moving off
 * it reached the tab bar, the only other stop, and the page's own stops then arrived behind the ring.
 */
export const holdsRingOnLoadingPage = (currentId: string | null | undefined, action: SemanticAction | null): boolean =>
  currentId === PAGE_LOADING_STOP_ID && action !== null && MOVEMENT_ACTIONS.has(action);
