/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

type ConfirmDestructiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** Prefix for the dialog's ids and test ids: `<prefix>-dialog`, `<prefix>-cancel`, `<prefix>-confirm`. */
  idPrefix: string;
};

export const ConfirmDestructiveDialog = ({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
  idPrefix,
}: ConfirmDestructiveDialogProps) => {
  // One confirmation per opening: a repeated activation before the dialog closes must not run the action twice.
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (open) confirmedRef.current = false;
  }, [open]);
  const confirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={`${idPrefix}-dialog`}>
        <AlertDialogHeader hideClose>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="not-sr-only">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel id={`${idPrefix}-cancel`} data-testid={`${idPrefix}-cancel`} data-open-focus>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            className={buttonVariants({ variant: "destructive" })}
            id={`${idPrefix}-confirm`}
            data-testid={`${idPrefix}-confirm`}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
