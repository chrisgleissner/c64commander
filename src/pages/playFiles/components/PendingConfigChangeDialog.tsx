/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
import type { PlaylistItem } from "@/pages/playFiles/types";

export type PendingConfigChangeState = {
  itemId: string;
  configRef: PlaylistItem["configRef"];
  origin?: PlaylistItem["configOrigin"];
  candidates?: PlaylistItem["configCandidates"];
};

type PendingConfigChangeDialogProps = {
  pendingConfigChange: PendingConfigChangeState | null;
  onPendingConfigChangeConfirmed: (change: PendingConfigChangeState) => void;
  onPendingConfigChangeClosed: () => void;
};

/** Asks before a config change clears the item's custom value edits. */
export const PendingConfigChangeDialog = ({
  pendingConfigChange,
  onPendingConfigChangeConfirmed,
  onPendingConfigChangeClosed,
}: PendingConfigChangeDialogProps) => {
  return (
    <>
      <AlertDialog
        open={Boolean(pendingConfigChange)}
        onOpenChange={(open) => {
          if (!open && pendingConfigChange) {
            onPendingConfigChangeClosed();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader hideClose>
            <AlertDialogTitle>Clear custom edits?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing the config file will clear this item&apos;s custom value edits. Continue only if you want to
              replace the current base config.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-open-focus>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingConfigChange) return;
                onPendingConfigChangeConfirmed(pendingConfigChange);
                onPendingConfigChangeClosed();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
