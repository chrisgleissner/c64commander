/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cn } from "@/lib/utils";
import { sidChipBadgeDescription, sidChipBadgeLabel, type SidChipCount } from "@/lib/playback/sidDisplayName";

type SidChipBadgeProps = {
  /** Two or more. A one-chip tune carries no marker, so callers pass `null` and draw nothing. */
  chipCount: SidChipCount;
  className?: string;
};

/**
 * The `2SID` / `3SID` marker shown beside a tune that needs more than one sound chip.
 *
 * Rare by design: about one HVSC tune in 180 uses a second or third chip, so this is usually the
 * only badge on screen when it appears. That is what lets it be set at the same size as the title's
 * companion text instead of shrunk into chrome, and why it needs no icon to be found.
 *
 * An earlier version drew a chip outline next to a `1SID` label on every row. The glyph was not
 * legible at that size, and the label restated what a Play screen full of tunes already is. Both are
 * gone; what is left is the one fact a listener cannot infer.
 *
 * No border, because the tinted ground already separates it, and a row that carries an origin icon,
 * a category and a duration should not read as a line of boxes.
 */
export const SidChipBadge = ({ chipCount, className }: SidChipBadgeProps) => (
  <span
    data-testid={`sid-chip-badge-${chipCount}`}
    role="img"
    aria-label={sidChipBadgeDescription(chipCount)}
    title={sidChipBadgeDescription(chipCount)}
    className={cn(
      "inline-flex shrink-0 items-center rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-semibold leading-none tracking-wide text-primary",
      className,
    )}
  >
    <span aria-hidden="true">{sidChipBadgeLabel(chipCount)}</span>
  </span>
);
