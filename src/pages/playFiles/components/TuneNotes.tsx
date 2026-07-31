/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** How much is shown before the note is cut off. Three lines is roughly the median note in full. */
const COLLAPSED_LINES = 3;

export type TuneNotesProps = {
  /** The note itself. Nothing renders when this is absent, which is the case for most tunes. */
  note: string;
  className?: string;
};

/**
 * STIL's prose about a tune, clamped rather than hidden.
 *
 * The notes are written by the archive's editors and their length is unbounded: measured across the
 * real document the median is 64 characters and the longest is 2,390. Putting the long ones on the
 * card unclamped would push the transport off the screen; putting all of them behind a control
 * would hide the short ones — the majority — behind a tap that reveals two lines, and would give no
 * hint that there was anything to reveal.
 *
 * So it is clamped to three lines and the control appears only when the note is actually longer
 * than that. That is measured, not guessed from the character count: what fits depends on the
 * width of the card and the size of the text, and a guess is wrong at both ends. In practice the
 * great majority of notes show in full with no control at all.
 */
export const TuneNotes = ({ note, className }: TuneNotesProps) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);

  const measure = useCallback(() => {
    const element = textRef.current;
    if (!element) return;
    // Only meaningful while clamped: expanded, scrollHeight and clientHeight are equal by
    // definition and the control would remove itself the moment it was used.
    if (expanded) return;
    setOverflows(element.scrollHeight - element.clientHeight > 1);
  }, [expanded]);

  useEffect(() => {
    setExpanded(false);
  }, [note]);

  useEffect(() => {
    measure();
    const element = textRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    // The card is resized by rotation and by the keyboard, and a note that fitted in landscape does
    // not fit in portrait.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, note]);

  if (!note.trim()) return null;

  return (
    <div className={cn("mt-1", className)} data-testid="tune-notes">
      <p
        ref={textRef}
        className={cn("whitespace-pre-line text-xs leading-snug text-muted-foreground/80", !expanded && "line-clamp-3")}
        style={expanded ? undefined : { WebkitLineClamp: COLLAPSED_LINES }}
        data-testid="tune-notes-text"
        data-expanded={expanded ? "true" : "false"}
      >
        {note}
      </p>
      {overflows ? (
        <button
          type="button"
          className="mt-0.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setExpanded((value) => !value)}
          data-testid="tune-notes-toggle"
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
};
