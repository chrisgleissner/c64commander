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
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

type StationQueueEditedDialogProps = {
  open: boolean;
  onKeepStationTunes: () => void;
  onReturnToPlaylist: () => void;
  onDismiss: () => void;
};

export const StationQueueEditedDialog = ({
  open,
  onKeepStationTunes,
  onReturnToPlaylist,
  onDismiss,
}: StationQueueEditedDialogProps) => (
  <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onDismiss())}>
    <AlertDialogContent data-testid="station-queue-edited-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>Keep the station&apos;s tunes or return to your playlist?</AlertDialogTitle>
        <AlertDialogDescription className="not-sr-only">
          You changed the queue while the station was playing.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction
          className={buttonVariants({ variant: "outline" })}
          data-testid="station-queue-keep"
          onClick={onKeepStationTunes}
        >
          Keep station tunes
        </AlertDialogAction>
        <AlertDialogAction data-testid="station-queue-return" onClick={onReturnToPlaylist}>
          Return to my playlist
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
