/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef } from "react";
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

type ClearPlaylistDialogProps = {
  open: boolean;
  itemCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

const describeRemoval = (itemCount: number) =>
  itemCount === 1
    ? "This removes the 1 item in the playlist. It cannot be undone."
    : `This removes all ${itemCount} items from the playlist. It cannot be undone.`;

export const ClearPlaylistDialog = ({ open, itemCount, onOpenChange, onConfirm }: ClearPlaylistDialogProps) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid="clear-playlist-dialog"
        // The keypad ring adopts whatever holds focus, so a second OK press lands on Cancel, not on Clear.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Clear playlist?</AlertDialogTitle>
          <AlertDialogDescription className="not-sr-only">{describeRemoval(itemCount)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} id="clear-playlist-cancel" data-testid="clear-playlist-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={buttonVariants({ variant: "destructive" })}
            id="clear-playlist-confirm"
            data-testid="clear-playlist-confirm"
          >
            Clear
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
