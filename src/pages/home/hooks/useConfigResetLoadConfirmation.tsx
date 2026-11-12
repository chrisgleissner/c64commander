/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useState, type ReactElement } from "react";
import {
  MachineActionConfirmationDialog,
  type MachineActionConfirmation,
} from "@/pages/home/dialogs/MachineActionConfirmationDialog";

type ConfigConfirmationKind = "load" | "reset";

export const CONFIG_CONFIRMATIONS: Record<ConfigConfirmationKind, MachineActionConfirmation> = {
  load: {
    actionName: "Load config from flash",
    consequence:
      "The current configuration is replaced by the one saved in flash. Changes that were not saved to flash are lost.",
    confirmLabel: "Load",
  },
  reset: {
    actionName: "Reset config to default",
    consequence:
      "Every setting returns to its firmware default. The current configuration is lost unless it was saved to flash.",
    confirmLabel: "Reset",
  },
};

type ConfigConfirmationDependencies = {
  handleAction: (action: () => Promise<unknown>, successTitle: string) => unknown;
  controls: {
    loadConfig: { mutateAsync: () => Promise<unknown> };
    resetConfig: { mutateAsync: () => Promise<unknown> };
  };
};

export function useConfigResetLoadConfirmation({ handleAction, controls }: ConfigConfirmationDependencies): {
  requestLoad: () => void;
  requestReset: () => void;
  confirmationDialog: ReactElement;
} {
  const run: Record<ConfigConfirmationKind, () => unknown> = {
    load: () => handleAction(() => controls.loadConfig.mutateAsync(), "Config loaded from flash"),
    reset: () => handleAction(() => controls.resetConfig.mutateAsync(), "Config reset to defaults"),
  };
  const [pending, setPending] = useState<ConfigConfirmationKind | null>(null);
  const requestLoad = useCallback(() => setPending("load"), []);
  const requestReset = useCallback(() => setPending("reset"), []);

  const confirmationDialog = (
    <MachineActionConfirmationDialog
      open={pending !== null}
      action={pending ? CONFIG_CONFIRMATIONS[pending] : null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      onConfirm={() => {
        const kind = pending;
        setPending(null);
        if (kind) void run[kind]();
      }}
    />
  );

  return { requestLoad, requestReset, confirmationDialog };
}
