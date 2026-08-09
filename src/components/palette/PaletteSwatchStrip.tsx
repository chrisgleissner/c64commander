/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { VicPalette } from "@/generated/vicPalettes";
import { paletteEntryHex } from "@/lib/streams/vicPalette";
import { cn } from "@/lib/utils";

/** The VIC-II color names, in hardware index order — what each swatch actually is. */
export const VIC_INDEX_NAMES = [
  "Black",
  "White",
  "Red",
  "Cyan",
  "Purple",
  "Green",
  "Blue",
  "Yellow",
  "Orange",
  "Brown",
  "Pink",
  "Dark gray",
  "Gray",
  "Light green",
  "Light blue",
  "Light gray",
];

/**
 * All sixteen colors of a palette, side by side.
 *
 * Carries more than the name does. "Neon Blast" tells you nothing; sixteen swatches tell you
 * everything, and on a small screen they are also what you recognize a palette by before you have
 * finished reading its name. Sixteen equal shares of the available width work down to the compact
 * profile, where the strip still gets the full width of its card.
 */
export function PaletteSwatchStrip({
  palette,
  className,
  testId,
  height = "h-6",
}: {
  palette: VicPalette;
  className?: string;
  testId?: string;
  height?: string;
}) {
  return (
    <div
      className={cn("flex gap-0.5 overflow-hidden rounded-md border border-border/60", className)}
      data-testid={testId}
      role="img"
      aria-label={`${palette.name} palette, sixteen colors`}
    >
      {palette.rgb.map((_, index) => (
        <span
          key={index}
          className={cn("flex-1", height)}
          style={{ background: paletteEntryHex(palette, index) }}
          title={`${index}: ${VIC_INDEX_NAMES[index]} ${paletteEntryHex(palette, index)}`}
          data-testid={testId ? `${testId}-swatch-${index}` : undefined}
        />
      ))}
    </div>
  );
}
