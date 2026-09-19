/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef } from "react";

import { Button } from "@/components/ui/button";
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
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <AppDialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent
        data-testid="machine-action-confirmation"
        /*
         * Opens on the action it is asking about. Radix otherwise focuses the content wrapper,
         * which is not a control: a keypad user then pressed Down three times, past the close
         * button and Cancel, to reach the one thing the dialog exists to offer. Reaching this
         * dialog at all takes a deliberate press, so confirming is the answer it should lead with,
         * and Cancel is still one Down away.
         */
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <AppDialogHeader>
          <AppDialogTitle>{action ? `${action.actionName}?` : "Confirm action?"}</AppDialogTitle>
          <AppDialogDescription>
            {action ? `Confirm ${action.actionName}.` : "Confirm the selected machine action."}
          </AppDialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          <p className="text-sm text-muted-foreground">
            {action?.consequence ?? "This action changes the machine state."}
          </p>
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant="destructive" onClick={onConfirm}>
            {action?.confirmLabel ?? "Confirm"}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </AppDialog>
  );
}
