/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { useAppMode } from "@/lib/appMode/appModeStore";
import { HVSC_CANCELED_STATUS_REASON } from "@/lib/hvsc/hvscCancellation";
import type { HvscPreparationState } from "@/lib/hvsc";

/**
 * In SID Player nothing downloads until the person has pressed Download on the sheet: the collection is large and
 * the app never spends their data unasked. The Full App starts the download as soon as the sheet opens, as before.
 */
export const useHvscDownloadConsent = ({
  preparationState,
  errorReason = null,
  sheetOpen,
}: {
  preparationState: HvscPreparationState;
  errorReason?: string | null;
  sheetOpen: boolean;
}): { awaiting: boolean; grant: () => void } => {
  const sidPlayer = useAppMode() === "sid-player";
  const [granted, setGranted] = useState(false);
  // A download the person canceled is back to where it started: nothing is failed, and the next one asks again.
  const idle =
    preparationState === "NOT_PRESENT" || (preparationState === "ERROR" && errorReason === HVSC_CANCELED_STATUS_REASON);
  useEffect(() => {
    if (!sheetOpen || idle) setGranted(false);
  }, [sheetOpen, idle]);
  return { awaiting: sidPlayer && !granted && idle, grant: () => setGranted(true) };
};
