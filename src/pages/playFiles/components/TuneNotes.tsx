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

  const body = (
    <p
      ref={textRef}
      // No `whitespace-pre-line`: the note arrives as one block with STIL's fixed-width line breaks
      // already removed, so it fills the width the card actually has. Honouring breaks here would
      // only let them back in.
      className={cn(
        "text-xs leading-snug text-muted-foreground/80",
        !expanded && "line-clamp-3",
        // Expanded, the note gets its own scroll rather than the card's. The longest note in the
        // collection is 2,390 characters, which unbounded pushes the transport and the progress bar
        // off the screen entirely — measured on the device, where even "Show less" ended up below
        // the fold, so the way back out of the expansion was itself out of reach.
        expanded && "max-h-52 overflow-y-auto",
      )}
      style={expanded ? undefined : { WebkitLineClamp: COLLAPSED_LINES }}
      data-testid="tune-notes-text"
      data-expanded={expanded ? "true" : "false"}
    >
      {note}
    </p>
  );

  // Nothing to expand: no control, no target, and no hint of one. This is the majority of notes.
  if (!overflows) {
    return (
      <div className={cn("mt-1", className)} data-testid="tune-notes">
        {body}
      </div>
    );
  }

  return (
    /* The whole note is the target, not just the words "Show more". Three lines of text with a
       small link beneath them is a large thing to look at and a small thing to hit, and the text
       is where the eye already is. The label stays as the affordance — without it there is nothing
       to say the block does anything — but it is a span, because a button inside a button is not
       valid and would swallow the tap it appears to invite. */
    <button
      type="button"
      className={cn("mt-1 block w-full cursor-pointer text-left", className)}
      onClick={() => setExpanded((value) => !value)}
      data-testid="tune-notes"
      aria-expanded={expanded}
    >
      {body}
      <span
        className="mt-0.5 block text-xs font-medium text-muted-foreground underline-offset-2 group-hover:underline"
        data-testid="tune-notes-toggle"
      >
        {expanded ? "Show less" : "Show more"}
      </span>
    </button>
  );
};
