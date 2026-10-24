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
  /** A tune is current; the toggle is then always present, so changing tunes never adds or removes its row. */
  available: boolean;
  /** The full credits line, which the card clips to two lines. */
  credits: string | null;
  /** The full facts line, which the card clips to two lines. */
  facts: string | null;
  /** STIL's name for this tune and its original artist, joined by `buildStilTuneLine`; usually null. */
  tuneLine: string | null;
  /** STIL's prose note about this tune, or null when there is none. */
  note: string | null;
  className?: string;
};

/** Everything known about the playing tune in full, folded behind one control below the transport. */
export const TuneDetails = ({ available, credits, facts, tuneLine, note, className }: TuneDetailsProps) => {
  const [expanded, setExpanded] = useState(false);
  const trimmedNote = note?.trim() ? note : null;

  // A new tune closes the block again, so its height never carries over to the next tune.
  useEffect(() => {
    setExpanded(false);
  }, [credits, facts, tuneLine, trimmedNote]);

  if (!available) return null;

  return (
    <div className={cn("mt-1", className)} data-testid="tune-details">
      <button
        type="button"
        // `id` as well as `data-testid`: automation through the accessibility tree reads the resource id from `id`.
        id="tune-details-toggle"
        data-testid="tune-details-toggle"
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
        <div id="tune-details-body" className="space-y-1" data-testid="tune-details-body">
          {credits ? (
            <p
              className="text-xs leading-snug text-foreground/80 [overflow-wrap:anywhere]"
              data-testid="tune-details-credits"
            >
              {credits}
            </p>
          ) : null}
          {facts ? (
            <p className="text-xs leading-snug text-foreground/80" data-testid="tune-details-facts">
              {facts}
            </p>
          ) : null}
          {tuneLine ? (
            <p className="text-xs leading-snug text-foreground/80" data-testid="playback-current-stil">
              {tuneLine}
            </p>
          ) : null}
          {trimmedNote ? <TuneNotes note={trimmedNote} /> : null}
          {!credits && !facts && !tuneLine && !trimmedNote ? (
            <p className="text-xs leading-snug text-muted-foreground" data-testid="tune-details-empty">
              Nothing is known about this tune yet.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
