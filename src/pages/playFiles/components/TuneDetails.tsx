/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { TuneNotes } from "./TuneNotes";

export type TuneDetailsProps = {
  /**
   * What STIL calls this tune, and who wrote the music it is based on — already joined by
   * `buildStilTuneLine`. Null for most of the archive, which STIL does not cover.
   */
  tuneLine: string | null;
  /** STIL's prose note about this tune, or null when there is none. */
  note: string | null;
  className?: string;
};

/**
 * The archive's annotation of the playing tune, collapsed by default behind one control.
 *
 * Everything above this on the card is what a listener needs in order to know what is playing and to
 * act on it: the title, then the SID header's own line — composer, year, chip, video standard, which
 * tune of the file, and how long it runs. Two of those are controls rather than text (the composer
 * opens a search for more by that person, "Tune 3 of 19" opens the list of the other eighteen), so
 * that line has to stay on the card.
 *
 * What is behind this control is STIL: the name the archive's editors give this particular tune, the
 * composer of the music it arranges, and their prose note about it. All three are worth reading and
 * none of them is needed to identify the tune or to control playback, which is what makes them the
 * part to fold away.
 *
 * The cost of showing them was the reason to fold them: measured on the smallest supported screen —
 * 320 x 426 CSS pixels — a tune with a full STIL entry spent five of the card's lines on it, roughly
 * 110 px, on a viewport whose scrollable area is under 300 px once the app bar and the tab bar are
 * subtracted. That was enough on its own to push the transport below the fold.
 *
 * Collapsed the block costs one 40 px row, and the row is labelled rather than a bare "Show more" so
 * that what it opens is readable while it is shut. The control follows the app's existing disclosure
 * pattern: a full-width button carrying `aria-expanded`, a title on the left and a chevron on the
 * right that flips when it opens.
 */
export const TuneDetails = ({ tuneLine, note, className }: TuneDetailsProps) => {
  const [expanded, setExpanded] = useState(false);
  const trimmedNote = note?.trim() ? note : null;

  // A new tune closes the block again. Left open it would apply its height to whatever came next,
  // including the majority of tunes for which STIL has only a note or only a title.
  useEffect(() => {
    setExpanded(false);
  }, [tuneLine, trimmedNote]);

  if (!tuneLine && !trimmedNote) return null;

  return (
    <div className={cn("mt-1", className)} data-testid="tune-details">
      <button
        type="button"
        // Both, and deliberately: automation outside the browser addresses this through the
        // accessibility tree, where Chrome fills the resource id from `id` and not from
        // `data-testid`. Same reasoning as the collapsible headers in Settings and Docs.
        id="tune-details-toggle"
        data-testid="tune-details-toggle"
        // The chevron leads the label rather than sitting at the far right of a full-width
        // row. The favourite action is now at the right of the facts line directly above
        // this control, and a right-hand chevron put a second 44px target immediately under
        // it - a thumb aiming for the heart and falling short would open this instead. The
        // button is also only as wide as its own content, so no part of its target sits
        // beneath the heart at all.
        className="flex min-h-11 w-fit items-center gap-2 pr-2 text-left text-xs font-medium text-muted-foreground"
        aria-expanded={expanded}
        aria-controls="tune-details-body"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span>About this tune</span>
      </button>
      {expanded ? (
        <div id="tune-details-body" data-testid="tune-details-body">
          {tuneLine ? (
            <p className="text-xs leading-snug text-foreground/80" data-testid="playback-current-stil">
              {tuneLine}
            </p>
          ) : null}
          {trimmedNote ? <TuneNotes note={trimmedNote} /> : null}
        </div>
      ) : null}
    </div>
  );
};
