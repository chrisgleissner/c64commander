/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";

import { PaletteSwatchStrip } from "@/components/palette/PaletteSwatchStrip";
import { ScreenColorsSheet } from "@/components/palette/ScreenColorsSheet";
import { loadVicPaletteId } from "@/lib/config/appSettings";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { DEVICE_VIC_PALETTE_ID, activeVicPalette, subscribeVicPalette } from "@/lib/streams/vicPalette";
import { subscribeVicPalettePreference } from "@/lib/streams/vicPalettePreference";

/**
 * The palette, on the Home page, in the card that already owns the picture.
 *
 * It lives in "Video" rather than a card of its own because "video" and "display" are the same word
 * to anyone using this, and two cards would only make people guess which one holds the colors. It
 * sits FIRST in that card because it is the row anyone actually changes; the mode, resolution and
 * output rows below it are set once and then left alone.
 *
 * The row itself carries only what fits on one line — a name and the sixteen swatches. Choosing
 * happens in a sheet, because a list of palettes with previews, and a choice of where to apply
 * them, does not fit a Home row at any display profile.
 */
export function ScreenColorsRow({
  focusParentId,
  focusOrder = 5,
  focusGroup = "home-controls",
}: {
  focusParentId?: string;
  focusOrder?: number;
  focusGroup?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedId = useSyncExternalStore(subscribeVicPalettePreference, loadVicPaletteId, loadVicPaletteId);
  const palette = useSyncExternalStore(subscribeVicPalette, activeVicPalette, activeVicPalette);
  const focusRef = useFocusItem<HTMLButtonElement>({
    id: "home-video-screen-colors",
    order: focusOrder,
    group: focusGroup,
    parentId: focusParentId,
    disabled: false,
  });

  const following = selectedId === DEVICE_VIC_PALETTE_ID;

  return (
    <div className="space-y-1.5" data-testid="home-video-screen-colors-row">
      <button
        ref={focusRef}
        type="button"
        onClick={() => setOpen(true)}
        data-testid="home-video-screen-colors"
        // `min-h-11` is the 44px WCAG 2.5.5 target size, the same floor the checkbox rows use.
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
      >
        <span className="shrink-0 text-muted-foreground">Screen colors</span>
        <span className="flex min-w-0 items-center gap-1">
          {/* Wraps to a second line rather than truncating. The sheet does show the name in full,
              but on the 320 px screen at the largest text size even "Default" was cut (77 px of
              text in a 71 px box), and a palette name cut to "Defaul…" reads as a defect. */}
          <span className="line-clamp-2 break-words text-foreground">{palette.name}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
      </button>
      <PaletteSwatchStrip palette={palette} height="h-5" testId="home-video-screen-colors-preview" />
      {/* Where the palette came from goes on its own line rather than after the name. Appended to
          the name it was the first thing to be truncated away on a narrow screen, which left the row
          saying "Default (from…" — the one part a suffix exists to convey.

          A span at the card's own size, not a smaller paragraph. Every other label in this card is
          a span, and shrinking a caption to make it fit a narrow screen is the thing the smallest-
          screen legibility floor exists to stop. */}
      {following ? (
        <span className="block text-muted-foreground" data-testid="home-video-screen-colors-following">
          Following the C64
        </span>
      ) : null}
      {/* Mounted only once opened. The sheet reads the machine's palette list, and Home should not
          carry that work — or the hooks behind it — for a row nobody has tapped. */}
      {open ? <ScreenColorsSheet open onOpenChange={setOpen} /> : null}
    </div>
  );
}
