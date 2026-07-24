/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SID_RADIO_STYLE_TILES, SID_RADIO_TASTE_UNLOCK_LIKES } from "@/pages/playFiles/hooks/useSidRadio";

export type SidRadioLauncherSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  likeCount: number;
  onStartStyle: (styleBit: number, label: string, fromLikes: boolean) => void;
  onStartTaste: () => void;
  onSurprise: () => void;
};

/**
 * The SID Radio launcher (spec §5.2). Composes seed × optional style: a grid of
 * the 9 style tiles, a "based on my likes" composition toggle (Q4/D10), a Taste
 * entry that unlocks at the like threshold (D1), and Surprise.
 */
export const SidRadioLauncherSheet = ({
  open,
  onOpenChange,
  likeCount,
  onStartStyle,
  onStartTaste,
  onSurprise,
}: SidRadioLauncherSheetProps) => {
  const [fromLikes, setFromLikes] = useState(false);
  const tasteUnlocked = likeCount >= SID_RADIO_TASTE_UNLOCK_LIKES;
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" data-testid="sid-radio-launcher-sheet">
        <SheetHeader>
          <SheetTitle>SID Radio</SheetTitle>
          <SheetDescription>Endless stations of similar SIDs — pick a mood, your taste, or both.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              data-testid="sid-radio-likes-toggle"
              checked={fromLikes}
              onCheckedChange={(value) => setFromLikes(value === true)}
            />
            <Label className="font-medium">Based on my likes</Label>
          </label>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SID_RADIO_STYLE_TILES.map((tile) => (
              <Button
                key={tile.bit}
                type="button"
                variant="outline"
                className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
                data-testid={`sid-radio-style-${tile.bit}`}
                onClick={() => {
                  close();
                  onStartStyle(tile.bit, tile.label, fromLikes);
                }}
              >
                <span className="text-sm font-medium">{tile.label}</span>
                <span className="text-xs text-muted-foreground">{tile.blurb}</span>
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              data-testid="sid-radio-taste"
              disabled={!tasteUnlocked}
              onClick={() => {
                close();
                onStartTaste();
              }}
            >
              From tunes you like
            </Button>
            {!tasteUnlocked ? (
              <p className="text-xs text-muted-foreground" data-testid="sid-radio-taste-hint">
                Like a few tunes to unlock ({likeCount}/{SID_RADIO_TASTE_UNLOCK_LIKES}).
              </p>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              data-testid="sid-radio-surprise"
              onClick={() => {
                close();
                onSurprise();
              }}
            >
              <Shuffle className="mr-1.5 h-4 w-4" /> Surprise me
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
