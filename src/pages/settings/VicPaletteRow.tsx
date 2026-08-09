/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";

import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  VIC_PALETTES,
  DEVICE_VIC_PALETTE_ID,
  activeVicPalette,
  paletteEntryHex,
  setActiveVicPalette,
  subscribeVicPalette,
} from "@/lib/streams/vicPalette";
import { loadVicPaletteId } from "@/lib/config/appSettings";
import { subscribeVicPalettePreference } from "@/lib/streams/vicPalettePreference";

/** The VIC-II colour names, in hardware index order — what each swatch actually is. */
const INDEX_NAMES = [
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
  "Dark grey",
  "Grey",
  "Light green",
  "Light blue",
  "Light grey",
];

/**
 * Choose which palette Live View paints with, and see all sixteen colours before committing.
 *
 * The preview matters more than the name: "Neonblast" tells you nothing, sixteen swatches tell you
 * everything. It updates as soon as a palette is picked, and the picture follows immediately.
 */
export function VicPaletteRow() {
  const { profile } = useDisplayProfile();
  const isCompact = profile === "compact";
  const paletteId = useSyncExternalStore(subscribeVicPalettePreference, loadVicPaletteId, loadVicPaletteId);
  const palette = useSyncExternalStore(subscribeVicPalette, activeVicPalette, activeVicPalette);

  return (
    <div className="col-span-2 min-w-0" data-testid="settings-vic-palette-row">
      {/* The description shares this row with a fixed w-40 Select. At 320px that left it
          an 84px column, narrow enough that "machine's" (87px) was split after the
          apostrophe. On the smallest screen the Select drops below the text instead, so
          the paragraph gets the full width. */}
      <div className={cn("flex gap-3 min-w-0", isCompact ? "flex-col items-stretch" : "items-start justify-between")}>
        <div className="min-w-0">
          <Label htmlFor="settings-vic-palette" className="font-medium">
            Screen colours
          </Label>
          <p className="text-sm text-muted-foreground">
            The C64 sends colour <em>numbers</em>, not colours, so this picks the shades the app paints them with. It
            changes only how Live View looks on this device — never what the C64 is doing, and never what anyone else
            sees. <strong>Device palette</strong> is the default: it reads the VPL selected on this C64U/U64 and falls
            back to <strong>Default</strong> if there is none or it cannot be read.
          </p>
        </div>
        <Select
          value={paletteId}
          onValueChange={(next) => {
            setActiveVicPalette(next);
          }}
        >
          <SelectTrigger
            id="settings-vic-palette"
            data-testid="settings-vic-palette"
            className={cn(isCompact ? "w-full" : "w-52 shrink-0")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEVICE_VIC_PALETTE_ID}>Device palette (automatic)</SelectItem>
            {VIC_PALETTES.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className="mt-2 flex gap-0.5 overflow-hidden rounded-md border border-border/60"
        data-testid="settings-vic-palette-preview"
      >
        {palette.rgb.map((_, index) => (
          <span
            key={index}
            className="h-6 flex-1"
            style={{ background: paletteEntryHex(palette, index) }}
            title={`${index}: ${INDEX_NAMES[index]} ${paletteEntryHex(palette, index)}`}
            data-testid={`settings-vic-palette-swatch-${index}`}
          />
        ))}
      </div>
      {palette.description ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="settings-vic-palette-description">
          {palette.description}
        </p>
      ) : null}
    </div>
  );
}
