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
import { cn } from "@/lib/utils";

type StationQueueEditedDialogProps = {
  open: boolean;
  stationTuneCount: number;
  /** Null when the saved playlist has not been read back since the app started. */
  playlistTuneCount: number | null;
  onKeepStationTunes: () => void;
  onReturnToPlaylist: () => void;
  onDismiss: () => void;
};

const tunes = (count: number) => `${count} ${count === 1 ? "tune" : "tunes"}`;

export const StationQueueEditedDialog = ({
  open,
  stationTuneCount,
  playlistTuneCount,
  onKeepStationTunes,
  onReturnToPlaylist,
  onDismiss,
}: StationQueueEditedDialogProps) => (
  <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onDismiss())}>
    <AlertDialogContent data-testid="station-queue-edited-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>Keep the radio tunes or your playlist?</AlertDialogTitle>
        <AlertDialogDescription className="not-sr-only">
          You changed the queue while the station was playing. Keep the {tunes(stationTuneCount)} now queued, or put
          back{" "}
          {playlistTuneCount === null ? "the playlist you had before the station" : `your ${tunes(playlistTuneCount)}`}.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction
          className={cn(buttonVariants({ variant: "outline" }), "text-foreground")}
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
