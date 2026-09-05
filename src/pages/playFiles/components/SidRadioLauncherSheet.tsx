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
import type { SidRadioStylePopulations } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import {
  SID_RADIO_STYLE_TILES,
  SID_RADIO_TASTE_UNLOCK_LIKES,
  isStylePopulated,
} from "@/pages/playFiles/hooks/useSidRadio";

export type SidRadioLauncherSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  likeCount: number;
  /** Per-style track counts from the similarity bundle; null while unread. */
  stylePopulations?: SidRadioStylePopulations | null;
  onStartStyle: (styleBit: number, label: string, fromLikes: boolean) => void;
  onStartTaste: () => void;
  onSurprise: () => void;
  /**
   * Display label of the tune a Song station is (or would be) seeded by.
   *
   * Absent — nothing playable to seed from, and no active Song station — hides the Song section
   * entirely, because a mood on its own is what the style tiles below already offer.
   */
  songSeedLabel?: string | null;
  /** The mood the active Song station is constrained to; `null` is all moods. */
  songStyleBit?: number | null;
  /** Start the Song station, or re-aim the active one, at this mood; `null` is all moods. */
  onStartSong?: (styleBit: number | null) => void;
};

/**
 * The mood choices offered over a Song seed: every style tile, plus the unconstrained station.
 *
 * "All moods" is an explicit option rather than an absent one so the choice reads as a setting with
 * a current value, and so a listener can get back to the unconstrained station without stopping and
 * restarting the one they are listening to.
 */
const songMoodOptions: ReadonlyArray<{ bit: number | null; key: string | null; label: string }> = [
  { bit: null, key: null, label: "All moods" },
  ...SID_RADIO_STYLE_TILES.map((tile) => ({ bit: tile.bit, key: tile.key, label: tile.label })),
];

/**
 * The SID Radio launcher (spec §5.2). Composes seed × optional style: a grid of
 * the 9 style tiles, a "based on my likes" composition toggle (Q4/D10), a Taste
 * entry that unlocks at the like threshold (D1), and Surprise.
 *
 * A style the export left empty is offered as a disabled tile rather than a
 * station that starts and immediately reports it has nothing to play (§5.4).
 */
export const SidRadioLauncherSheet = ({
  open,
  onOpenChange,
  likeCount,
  stylePopulations = null,
  onStartStyle,
  onStartTaste,
  onSurprise,
  songSeedLabel = null,
  songStyleBit = null,
  onStartSong,
}: SidRadioLauncherSheetProps) => {
  const [fromLikes, setFromLikes] = useState(false);
  const tasteUnlocked = likeCount >= SID_RADIO_TASTE_UNLOCK_LIKES;
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="overflow-y-auto" data-testid="sid-radio-launcher-sheet">
        <SheetHeader>
          <SheetTitle>SID Radio</SheetTitle>
          <SheetDescription>Endless stations of similar SIDs — pick a mood, your taste, or both.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 pt-3">
          {songSeedLabel && onStartSong ? (
            <div className="flex flex-col gap-2" data-testid="sid-radio-song-section">
              <Label className="font-medium">Similar to {songSeedLabel}</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {songMoodOptions.map((option) => {
                  // A mood with no members admits nothing, so the intersection with any seed is
                  // empty before the walk starts — the same reason the style tiles disable it.
                  const populated = option.key === null || isStylePopulated(stylePopulations, option.key);
                  const selected = songStyleBit === option.bit;
                  return (
                    <Button
                      key={option.key ?? "all"}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      className="h-auto whitespace-normal py-1.5 text-xs"
                      data-testid={`sid-radio-song-mood-${option.bit ?? "all"}`}
                      aria-pressed={selected}
                      disabled={!populated}
                      onClick={() => {
                        close();
                        onStartSong(option.bit);
                      }}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              data-testid="sid-radio-likes-toggle"
              checked={fromLikes}
              onCheckedChange={(value) => setFromLikes(value === true)}
            />
            <Label className="font-medium">Based on my likes</Label>
          </label>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SID_RADIO_STYLE_TILES.map((tile) => {
              const population = stylePopulations?.[tile.key];
              const populated = isStylePopulated(stylePopulations, tile.key);
              return (
                <Button
                  key={tile.bit}
                  type="button"
                  variant="outline"
                  // `px-2` rather than the button default `px-4`: two columns at 320px leave each
                  // tile a 108px content box, and "Experimental" is 113px, so the global
                  // `overflow-wrap: anywhere` in `index.css` split it after "Experiment".
                  className="h-auto flex-col items-start gap-0.5 whitespace-normal px-2 py-2 text-left"
                  data-testid={`sid-radio-style-${tile.bit}`}
                  disabled={!populated}
                  onClick={() => {
                    close();
                    onStartStyle(tile.bit, tile.label, fromLikes);
                  }}
                >
                  <span className="text-sm font-medium">{tile.label}</span>
                  <span className="text-xs text-muted-foreground">{tile.blurb}</span>
                  {/* No track count.
                      Every mood draws on tens of thousands of tunes and the numbers
                      sat within a few per cent of each other, so the figure told a
                      listener nothing about which mood to pick — it only added a
                      third line to every tile. A release where a mood held too
                      little to be worth offering is caught at build time instead;
                      see `assertStylePopulations` in `scripts/fetch-sidcorr.mjs`.
                      The empty state is still spelled out, because a greyed tile
                      with no explanation is worse than one with a reason. */}
                  {population !== undefined && !populated ? (
                    <span className="text-xs text-muted-foreground" data-testid={`sid-radio-style-${tile.bit}-size`}>
                      None in this release
                    </span>
                  ) : null}
                </Button>
              );
            })}
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
