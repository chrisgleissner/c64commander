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
  ROM_BASIC_DIALOG_TITLE,
  ROM_LISTED_DIALOG_TITLE,
  romBasicDialogText,
  romListedDialogText,
  type RomDialogKind,
  type RomListedDialogChoice,
} from "@/pages/playFiles/romDependencyGate";

export type RomDependencyDialogProps = {
  /** The label of the song the listener chose, or null while the dialog is closed. */
  label: string | null;
  /** "listed": may sound wrong, the listener decides. "needs-basic": cannot play here, a notice with one button. */
  kind?: RomDialogKind;
  onChoose: (choice: RomListedDialogChoice) => void;
};

/**
 * Shown when the listener picks a song that needs the C64's ROMs and nothing can play it with them.
 * Dismissing it any other way counts as Cancel.
 */
export const RomDependencyDialog = ({ label, kind = "listed", onChoose }: RomDependencyDialogProps) =>
  kind === "needs-basic" ? (
    <AlertDialog open={label !== null} onOpenChange={() => onChoose("cancel")}>
      <AlertDialogContent data-testid="rom-dependency-dialog">
        <AlertDialogHeader hideClose>
          <AlertDialogTitle>{ROM_BASIC_DIALOG_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>{romBasicDialogText()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction data-testid="rom-dependency-dismiss" onClick={() => onChoose("cancel")}>
            OK
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : (
    <AlertDialog open={label !== null} onOpenChange={() => onChoose("cancel")}>
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
