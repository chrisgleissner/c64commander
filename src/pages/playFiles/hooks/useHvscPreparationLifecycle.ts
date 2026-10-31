/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { reportUserError } from "@/lib/uiErrors";
import type { HvscPreparationState } from "@/lib/hvsc";
import {
  shouldAutoRunHvscPreparation,
  shouldCancelHvscLifecycleOnDisable,
} from "@/pages/playFiles/hvscControlsVisibility";

type HvscLifecycle = {
  hvscUpdating: boolean;
  hvscPreparationState: HvscPreparationState;
  runHvscPreparation: () => Promise<void>;
  handleHvscCancel: () => Promise<void>;
};

/**
 * Starts the preparation when its sheet opens (once the person has agreed to the download, where agreement is
 * asked for), and shuts a running preparation down when HVSC is switched off.
 */
export const useHvscPreparationLifecycle = ({
  hvsc,
  controlsEnabled,
  sheetOpen,
  setSheetOpen,
  awaitingConsent,
}: {
  hvsc: HvscLifecycle;
  controlsEnabled: boolean;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  awaitingConsent: boolean;
}): void => {
  const disableCancellationRequestedRef = useRef(false);

  useEffect(() => {
    const autoRun = shouldAutoRunHvscPreparation({
      enabled: controlsEnabled,
      sheetOpen,
      updating: hvsc.hvscUpdating,
      preparationState: hvsc.hvscPreparationState,
    });
    if (autoRun && !awaitingConsent) void hvsc.runHvscPreparation();
  }, [
    hvsc.hvscPreparationState,
    hvsc.hvscUpdating,
    hvsc.runHvscPreparation,
    controlsEnabled,
    sheetOpen,
    awaitingConsent,
  ]);

  useEffect(() => {
    if (controlsEnabled) {
      disableCancellationRequestedRef.current = false;
      return;
    }

    if (sheetOpen) {
      setSheetOpen(false);
    }

    if (!shouldCancelHvscLifecycleOnDisable(controlsEnabled, hvsc.hvscPreparationState)) {
      disableCancellationRequestedRef.current = false;
      return;
    }

    if (disableCancellationRequestedRef.current) return;
    disableCancellationRequestedRef.current = true;

    void hvsc.handleHvscCancel().catch((error) => {
      disableCancellationRequestedRef.current = false;
      reportUserError({
        operation: "HVSC_CANCEL",
        title: "HVSC shutdown failed",
        description: "HVSC was disabled, but the active preparation task could not be canceled cleanly.",
        error,
        context: { preparationState: hvsc.hvscPreparationState },
        // The disable itself succeeded; a lingering background task is a
        // notice, not a destructive error (ERROR_POLICY §1 S2).
        severity: "S2",
      });
    });
  }, [hvsc.handleHvscCancel, hvsc.hvscPreparationState, controlsEnabled, sheetOpen, setSheetOpen]);
};
