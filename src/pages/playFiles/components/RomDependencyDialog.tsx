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
  romUnplayableDialogText,
  type RomListedDialogChoice,
} from "@/pages/playFiles/romDependencyGate";

export type RomDependencyPrompt = {
  label: string;
  /** False when the phone's engine cannot start the song without the ROMs: the dialog only explains. */
  canPlayAnyway: boolean;
};

export type RomDependencyDialogProps = {
  /** The song the listener chose, or null while the dialog is closed. */
  prompt: RomDependencyPrompt | null;
  onChoose: (choice: RomListedDialogChoice) => void;
};

/**
 * Shown when the listener picks a song that needs the C64's ROMs and nothing can play it with them.
 * Dismissing it any other way counts as Cancel.
 */
export const RomDependencyDialog = ({ prompt, onChoose }: RomDependencyDialogProps) => (
  <AlertDialog open={prompt !== null} onOpenChange={() => onChoose("cancel")}>
    <AlertDialogContent data-testid="rom-dependency-dialog">
      <AlertDialogHeader hideClose>
        <AlertDialogTitle>{ROM_LISTED_DIALOG_TITLE}</AlertDialogTitle>
        <AlertDialogDescription>
          {prompt === null
            ? ""
            : prompt.canPlayAnyway
              ? romListedDialogText(prompt.label)
              : romUnplayableDialogText(prompt.label)}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="rom-dependency-cancel" onClick={() => onChoose("cancel")}>
          {prompt?.canPlayAnyway === false ? "OK" : "Cancel"}
        </AlertDialogCancel>
        {prompt?.canPlayAnyway === false ? null : (
          <AlertDialogAction data-testid="rom-dependency-play-anyway" onClick={() => onChoose("play-anyway")}>
            Play anyway
          </AlertDialogAction>
        )}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
