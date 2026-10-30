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

export type UnavailableConfigPromptState = {
  item: PlaylistItem;
  configFileName: string | null;
  reason: string;
  resolve: (choice: "play-without-config" | "cancel") => void;
};

type PlaylistConfigDialogsProps = {
  pendingConfigChange: PendingConfigChangeState | null;
  onPendingConfigChangeConfirmed: (change: PendingConfigChangeState) => void;
  onPendingConfigChangeClosed: () => void;
  unavailableConfigPrompt: UnavailableConfigPromptState | null;
  onUnavailableConfigPromptClosed: () => void;
};

/** The two confirmations a playlist item's config can raise: replacing edited values, and a missing config file. */
export const PlaylistConfigDialogs = ({
  pendingConfigChange,
  onPendingConfigChangeConfirmed,
  onPendingConfigChangeClosed,
  unavailableConfigPrompt,
  onUnavailableConfigPromptClosed,
}: PlaylistConfigDialogsProps) => {
  const resolveUnavailableConfigPrompt = (choice: "play-without-config" | "cancel") => {
    if (!unavailableConfigPrompt) return;
    unavailableConfigPrompt.resolve(choice);
    onUnavailableConfigPromptClosed();
  };

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

      <AlertDialog
        open={Boolean(unavailableConfigPrompt)}
        onOpenChange={(open) => {
          if (!open) resolveUnavailableConfigPrompt("cancel");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader hideClose>
            <AlertDialogTitle>Config unavailable</AlertDialogTitle>
            <AlertDialogDescription>
              {unavailableConfigPrompt
                ? `${unavailableConfigPrompt.configFileName ?? "The selected config"} is unavailable for ${unavailableConfigPrompt.item.label}. Play without config, or cancel?`
                : "The selected config is unavailable."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {unavailableConfigPrompt ? (
            <div className="text-sm text-muted-foreground">{unavailableConfigPrompt.reason}</div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveUnavailableConfigPrompt("cancel")}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveUnavailableConfigPrompt("play-without-config")}>
              Play without config
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
