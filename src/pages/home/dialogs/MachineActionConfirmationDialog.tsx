/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import { useTargetDeviceIdentity } from "@/hooks/useTargetDeviceIdentity";
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";

export type MachineActionConfirmation = {
  actionName: string;
  consequence: string;
  confirmLabel?: string;
};

type MachineActionConfirmationDialogProps = {
  open: boolean;
  action: MachineActionConfirmation | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function MachineActionConfirmationDialog({
  open,
  action,
  onOpenChange,
  onConfirm,
}: MachineActionConfirmationDialogProps) {
  const targetDevice = useTargetDeviceIdentity();
  // With more than one device saved, the one the action goes to is named: it may not be the one in front of you.
  const onDevice = targetDevice.multiDevice && targetDevice.fullLabel ? ` on ${targetDevice.fullLabel}` : "";

  return (
    <AppDialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent data-testid="machine-action-confirmation">
        <AppDialogHeader hideClose>
          <AppDialogTitle>{action ? `${action.actionName}?` : "Confirm action?"}</AppDialogTitle>
          <AppDialogDescription>
            {action ? `Confirm ${action.actionName}${onDevice}.` : `Confirm the selected machine action${onDevice}.`}
          </AppDialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          <p className="text-sm text-muted-foreground">
            {action?.consequence ?? "This action changes the machine state."}
          </p>
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-open-focus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {action?.confirmLabel ?? "Confirm"}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </AppDialog>
  );
}
