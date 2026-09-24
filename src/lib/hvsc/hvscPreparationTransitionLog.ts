/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { describeHvscPreparationTransition, type HvscPreparationSnapshot } from "@/lib/hvsc/hvscPreparationState";

/**
 * The last preparation state logged, kept for the whole session rather than per mount of the Play
 * page: per mount, every visit to Play logged "unknown -> NOT_PRESENT" again although nothing had
 * changed.
 */
let lastLogged: HvscPreparationSnapshot | null = null;

export const logHvscPreparationTransition = (next: HvscPreparationSnapshot): void => {
  if (
    lastLogged &&
    lastLogged.state === next.state &&
    lastLogged.failedPhase === next.failedPhase &&
    lastLogged.errorReason === next.errorReason
  ) {
    return;
  }
  addLog("info", "HVSC preparation state transition", {
    transition: describeHvscPreparationTransition(lastLogged, next),
    fromState: lastLogged?.state ?? null,
    toState: next.state,
    failedPhase: next.failedPhase,
    reason: next.errorReason,
  });
  lastLogged = next;
};

export const resetHvscPreparationTransitionLogForTests = (): void => {
  lastLogged = null;
};
