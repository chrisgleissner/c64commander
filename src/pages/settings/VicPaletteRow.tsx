/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  VIC_PALETTES,
  activeVicPalette,
  paletteEntryHex,
  setActiveVicPalette,
  vicPaletteById,
} from "@/lib/streams/vicPalette";

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
  const [paletteId, setPaletteId] = useState<string>(() => activeVicPalette().id);
  const palette = vicPaletteById(paletteId);

  return (
    <div className="col-span-2 min-w-0" data-testid="settings-vic-palette-row">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <Label htmlFor="settings-vic-palette" className="font-medium">
            Screen colours
          </Label>
          <p className="text-xs text-muted-foreground">
            The C64 sends colour <em>numbers</em>, not colours, so this picks the shades the app paints them with. It
            changes only how Live View looks on this device — never what the C64 is doing, and never what anyone else
            sees. <strong>Default</strong> matches the machine&apos;s own palette.
          </p>
        </div>
        <Select
          value={paletteId}
          onValueChange={(next) => {
            setPaletteId(next);
            setActiveVicPalette(next);
          }}
        >
          <SelectTrigger id="settings-vic-palette" data-testid="settings-vic-palette" className="w-40 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="settings-vic-palette-description">
          {palette.description}
        </p>
      ) : null}
    </div>
  );
}
