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
import {
  ROM_LISTED_DIALOG_TITLE,
  romListedDialogText,
  type RomListedDialogChoice,
} from "@/pages/playFiles/romDependencyGate";

export type RomDependencyDialogProps = {
  /** The label of the song the listener chose, or null while the dialog is closed. */
  label: string | null;
  onChoose: (choice: RomListedDialogChoice) => void;
};

/**
 * Shown when the listener picks a song that needs the C64's ROMs and nothing can play it with them.
 * Dismissing it any other way counts as Cancel.
 */
export const RomDependencyDialog = ({ label, onChoose }: RomDependencyDialogProps) => (
  <AlertDialog open={label !== null} onOpenChange={(open) => (open ? undefined : onChoose("cancel"))}>
    <AlertDialogContent data-testid="rom-dependency-dialog">
      <AlertDialogHeader hideClose>
        <AlertDialogTitle>{ROM_LISTED_DIALOG_TITLE}</AlertDialogTitle>
        <AlertDialogDescription>{label === null ? "" : romListedDialogText(label)}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="rom-dependency-cancel" onClick={() => onChoose("cancel")}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction data-testid="rom-dependency-play-anyway" onClick={() => onChoose("play-anyway")}>
          Play anyway
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
