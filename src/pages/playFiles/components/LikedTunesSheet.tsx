/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { useIsExternallyOpen, type ExternalOpenState } from "@/hooks/useExternalOpenState";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { LikedTunesList } from "@/pages/playFiles/components/LikedTunesList";

export type LikedTunesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlay: (items: PlaylistItem[], startIndex: number) => void;
};

/** The Liked tunes collection in a bottom sheet (spec §5.5). */
export const LikedTunesSheet = ({ open, onOpenChange, onPlay }: LikedTunesSheetProps) => (
  <AppSheet open={open} onOpenChange={onOpenChange}>
    <AppSheetContent className="overflow-hidden p-0" data-testid="liked-tunes-sheet">
      <AppSheetHeader>
        <AppSheetTitle>Liked tunes</AppSheetTitle>
        <AppSheetDescription>
          Everything you have ♥-liked. Plays as a normal list — Shuffle and Repeat apply.
        </AppSheetDescription>
      </AppSheetHeader>
      <AppSheetBody className="px-3 pt-3 pb-[calc(0.75rem+var(--safe-area-inset-bottom))]">
        <LikedTunesList
          onPlay={(items, startIndex) => {
            onOpenChange(false);
            onPlay(items, startIndex);
          }}
        />
      </AppSheetBody>
    </AppSheetContent>
  </AppSheet>
);

/** The sheet with its open flag in an external state, so opening it does not render the page that holds the button. */
export const LikedTunesSheetHost = ({
  state,
  onPlay,
}: {
  state: ExternalOpenState;
  onPlay: LikedTunesSheetProps["onPlay"];
}) => <LikedTunesSheet open={useIsExternallyOpen(state)} onOpenChange={state.set} onPlay={onPlay} />;
