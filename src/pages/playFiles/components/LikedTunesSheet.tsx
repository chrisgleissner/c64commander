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
import type { PlaylistItem } from "@/pages/playFiles/types";
import { LikedTunesList } from "@/pages/playFiles/components/LikedTunesList";

export type LikedTunesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlay: (items: PlaylistItem[], startIndex: number) => void;
};

/** The Liked Tunes collection in a bottom sheet (spec §5.5). */
export const LikedTunesSheet = ({ open, onOpenChange, onPlay }: LikedTunesSheetProps) => (
  <AppSheet open={open} onOpenChange={onOpenChange}>
    <AppSheetContent className="overflow-hidden p-0" data-testid="liked-tunes-sheet">
      <AppSheetHeader>
        <AppSheetTitle>Liked Tunes</AppSheetTitle>
        <AppSheetDescription>
          Everything you have ♥-liked. Plays as a normal list — Shuffle and Repeat apply.
        </AppSheetDescription>
      </AppSheetHeader>
      <AppSheetBody className="px-3 py-3">
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
