/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Reused across every instance: one canvas is enough to measure text with. */
let measureContext: CanvasRenderingContext2D | null = null;
const getMeasureContext = (): CanvasRenderingContext2D | null => {
  if (measureContext) return measureContext;
  if (typeof document === "undefined") return null;
  measureContext = document.createElement("canvas").getContext("2d");
  return measureContext;
};

export interface FittedTextProps {
  /** Wordings from longest to shortest. The longest that fits is the one shown. */
  variants: readonly string[];
  /** The accessible name, which stays whole however narrow the space gets. Defaults to `variants[0]`. */
  label?: string;
  className?: string;
}

/**
 * Shows the longest of several wordings that fits the space, rather than truncating one.
 *
 * A truncated label is a label that has stopped naming its thing: "Soft IE...", "Experimental
 * Fe...". Given the wordings a designer is happy with — "Soft IEC Drive", "IEC Drive", "IEC" —
 * this picks whichever the available width allows, so the text is always whole.
 *
 * The width is measured with a canvas against the element's own computed font, so the choice
 * follows the display profile's font size, the reader's text-size setting and the actual string,
 * without writing to the DOM to test a fit or laying out each candidate.
 *
 * The accessible name is the full wording regardless of which one is drawn, so a screen reader and
 * the keypad ring always announce the same thing. It is carried both by `aria-label` and by a
 * visually hidden text node, because WebKit does not apply `aria-label` to a span with no role:
 * on iOS run 33842686343 the "Stable Features" section header was absent from the accessibility
 * tree entirely, leaving its name as just the badge and the summary.
 */
export const FittedText = ({ variants, label, className }: FittedTextProps) => {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [index, setIndex] = useState(0);

  const fit = useCallback(() => {
    const host = hostRef.current;
    const context = getMeasureContext();
    if (!host || !context || variants.length === 0) return;
    const available = host.clientWidth;
    // Zero while the element is not laid out yet (a closed card, a hidden tab). Choosing on a zero
    // width would latch the shortest wording and never revisit it, so leave the choice alone.
    if (available <= 0) return;
    const style = getComputedStyle(host);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const firstFitting = variants.findIndex((variant) => context.measureText(variant).width <= available);
    // None fits: the shortest is the least bad, and is what the caller listed last for this case.
    setIndex(firstFitting === -1 ? variants.length - 1 : firstFitting);
  }, [variants]);

  useLayoutEffect(() => {
    fit();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [fit]);

  const accessibleName = label ?? variants[0] ?? "";
  const drawn = variants[index] ?? accessibleName;
  // The drawn wording is the accessible name in the common case, so it is left in the tree rather
  // than hidden and restated. Only an abbreviation is hidden and paired with the full wording.
  const drawnIsAccessibleName = drawn === accessibleName;
  return (
    <span
      ref={hostRef}
      // `whitespace-nowrap` and `block`: the measurement compares one line against the element's
      // width, so the element has to be the full line and the text has to stay on it.
      className={cn("block whitespace-nowrap", className)}
      aria-label={accessibleName}
    >
      <span aria-hidden={drawnIsAccessibleName ? undefined : true}>{drawn}</span>
      {drawnIsAccessibleName ? null : <span className="sr-only">{accessibleName}</span>}
    </span>
  );
};
