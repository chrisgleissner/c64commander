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
import type { ActiveStation } from "@/pages/playFiles/hooks/useSidRadio";

export type SidRadioChipProps = {
  station: ActiveStation;
  /** One-line "why this tune" provenance for the current track (spec §5.3, Q8). */
  whyThisTune?: string | null;
  onStop: () => void;
};

const stationName = (station: ActiveStation): string => {
  if (station.seedKind === "song") return `Radio: ${station.seedLabel}`;
  if (station.seedKind === "taste") return "Radio: Tunes you like";
  return `${station.seedLabel} Radio`;
};

/**
 * The now-playing station chip (spec §5.3). Names the active station, doubles as
 * Stop (`sid-radio-stop`), and expands a one-line "why this tune" provenance.
 */
export const SidRadioChip = ({ station, whyThisTune, onStop }: SidRadioChipProps) => {
  const [expanded, setExpanded] = useState(false);

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
          <span className="truncate text-sm font-medium">{stationName(station)}</span>
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
