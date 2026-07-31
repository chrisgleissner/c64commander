/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Radio, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveTrackDisplayName } from "@/lib/playback/sidDisplayName";
import { useFriendlySidNames } from "@/lib/playback/useFriendlySidNames";
import { SID_RADIO_STYLE_TILES, type ActiveStation } from "@/pages/playFiles/hooks/useSidRadio";

export type SidRadioChipProps = {
  station: ActiveStation;
  /** One-line "why this tune" provenance for the current track (spec §5.3, Q8). */
  whyThisTune?: string | null;
  onStop: () => void;
};

const stationName = (station: ActiveStation, friendlyNames: boolean): string => {
  // Only a song station's seed label is a file name; a style or taste station is seeded by a mood or
  // by the Likes list and already carries prose. The stored `seedLabel` is left as it is — this
  // renames what the chip draws, not what the resumed session descriptor holds.
  const seedName =
    station.seedKind === "song"
      ? `Radio: ${resolveTrackDisplayName({ label: station.seedLabel, category: "sid", friendlyNames }).title}`
      : station.seedKind === "taste"
        ? "Radio: Tunes you like"
        : `${station.seedLabel} Radio`;
  // A station can be constrained by a seed AND by a mood, and both decide what it plays, so the chip
  // has to name both — a listener who picked "Melodic" over a tune otherwise has no way to tell that
  // station from the unconstrained one. A style station is exempt because its seed label already IS
  // the mood, and "Melodic Radio · Melodic" says the same thing twice.
  if (station.styleBit === null || station.seedKind === "style") return seedName;
  const mood = SID_RADIO_STYLE_TILES.find((tile) => tile.bit === station.styleBit)?.label;
  return mood ? `${seedName} · ${mood}` : seedName;
};

/**
 * The now-playing station chip (spec §5.3). Names the active station, doubles as
 * Stop (`sid-radio-stop`), and expands a one-line "why this tune" provenance.
 */
export const SidRadioChip = ({ station, whyThisTune, onStop }: SidRadioChipProps) => {
  const [expanded, setExpanded] = useState(false);
  const friendlyNames = useFriendlySidNames();

  return (
    <div
      className="flex w-full flex-col gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2 py-1"
      data-testid="sid-radio-chip"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          data-testid="sid-radio-chip-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <Radio className={cn("h-4 w-4 shrink-0 text-primary")} />
          <span className="truncate text-sm font-medium">{stationName(station, friendlyNames)}</span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          data-testid="sid-radio-stop"
          aria-label="Stop radio"
          title="Stop radio"
          onClick={onStop}
        >
          <X />
        </Button>
      </div>
      {expanded && whyThisTune ? (
        <p className="pl-6 text-xs text-muted-foreground" data-testid="sid-radio-why">
          {whyThisTune}
        </p>
      ) : null}
    </div>
  );
};
