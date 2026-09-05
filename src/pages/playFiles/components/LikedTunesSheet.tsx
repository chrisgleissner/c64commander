/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { LikedTunesList } from "@/pages/playFiles/components/LikedTunesList";

export type LikedTunesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlay: (items: PlaylistItem[], startIndex: number) => void;
};

/** The Liked Tunes collection in a bottom sheet (spec §5.5). */
export const LikedTunesSheet = ({ open, onOpenChange, onPlay }: LikedTunesSheetProps) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="bottom" className="overflow-y-auto" data-testid="liked-tunes-sheet">
      <SheetHeader>
        <SheetTitle>Liked Tunes</SheetTitle>
        <SheetDescription>
          Everything you have ♥-liked. Plays as a normal list — Shuffle and Repeat apply.
        </SheetDescription>
      </SheetHeader>
      <div className="pt-3">
        <LikedTunesList
          onPlay={(items, startIndex) => {
            onOpenChange(false);
            onPlay(items, startIndex);
          }}
        />
      </div>
    </SheetContent>
  </Sheet>
);
