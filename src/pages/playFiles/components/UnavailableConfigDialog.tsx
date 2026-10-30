/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useState } from "react";
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

export type UnavailableConfigChoice = "play-without-config" | "cancel";

export type UnavailableConfigPrompt = {
  item: PlaylistItem;
  configFileName: string | null;
  reason: string;
  resolve: (choice: UnavailableConfigChoice) => void;
};

/** The question "play without the unavailable config?", as a promise the play path can await. */
export const useUnavailableConfigPrompt = () => {
  const [prompt, setPrompt] = useState<UnavailableConfigPrompt | null>(null);

  const ask = useCallback(
    (item: PlaylistItem, context: { configFileName: string | null; reason: string }) =>
      new Promise<UnavailableConfigChoice>((resolve) => {
        setPrompt({ item, configFileName: context.configFileName, reason: context.reason, resolve });
      }),
    [],
  );

  const choose = useCallback(
    (choice: UnavailableConfigChoice) => {
      if (!prompt) return;
      prompt.resolve(choice);
      setPrompt(null);
    },
    [prompt],
  );

  return { prompt, ask, choose };
};

export type UnavailableConfigDialogProps = {
  prompt: UnavailableConfigPrompt | null;
  onChoose: (choice: UnavailableConfigChoice) => void;
};

/** Shown when a song's selected config file cannot be loaded. Dismissing it any other way counts as Cancel. */
export const UnavailableConfigDialog = ({ prompt, onChoose }: UnavailableConfigDialogProps) => (
  <AlertDialog
    open={Boolean(prompt)}
    onOpenChange={(open) => {
      if (!open) onChoose("cancel");
    }}
  >
    <AlertDialogContent>
      <AlertDialogHeader hideClose>
        <AlertDialogTitle>Config unavailable</AlertDialogTitle>
        <AlertDialogDescription>
          {prompt
            ? `${prompt.configFileName ?? "The selected config"} is unavailable for ${prompt.item.label}. Play without config, or cancel?`
            : "The selected config is unavailable."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {prompt ? <div className="text-sm text-muted-foreground">{prompt.reason}</div> : null}
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => onChoose("cancel")}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={() => onChoose("play-without-config")}>Play without config</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
