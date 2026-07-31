/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { ListMusic, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveTrackDisplayName } from "@/lib/playback/sidDisplayName";
import { useFriendlySidNames } from "@/lib/playback/useFriendlySidNames";
import { SID_RADIO_STYLE_TILES, type ActiveStation } from "@/pages/playFiles/hooks/useSidRadio";

export type SidRadioChipProps = {
  /** The running station, or null when the queue is just the playlist. */
  station: ActiveStation | null;
  /** One-line "why this tune" provenance for the current track (spec §5.3, Q8). */
  whyThisTune?: string | null;
  onStop: () => void;
};

/** Every state of this row is exactly this tall, so starting or stopping a station moves nothing. */
const ROW_HEIGHT = "min-h-[2.75rem]";

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
 * The line at the top of the Now Playing card that says where the queue is coming from.
 *
 * It used to be a bordered, tinted chip below the transport, the progress bar, the volume row and
 * the playlist toggles — the very bottom of the card. That is the wrong end of the reading order:
 * which station is playing is context for everything underneath it, not a footnote after the
 * controls. It now leads the card, and the reading order is source → tune → controls → settings.
 *
 * It is present whether or not a station is running, and every state is the same height. That is
 * what keeps the card still: if this row only existed during a station, starting one would push the
 * title, the transport and the progress bar down the screen, and the transport is the one thing on
 * this page people hit without looking. When nothing is steering the queue the row simply names the
 * playlist, which is also the honest answer to "where is this coming from".
 *
 * The chip's box has gone with it. A tinted, bordered rectangle inside an already bordered card,
 * above four bordered transport buttons, was one competing edge too many; a single rule underneath
 * says "context above, content below" with far less ink. Stop is a labelled control rather than a
 * 28 px bare ×, which was under the project's hit-target floor and read as "close this" — the same
 * ambiguity the ranking ✕ has, and the same fix.
 */
export const SidRadioChip = ({ station, whyThisTune, onStop }: SidRadioChipProps) => {
  const [expanded, setExpanded] = useState(false);
  const friendlyNames = useFriendlySidNames();

  return (
    <div
      className="flex w-full flex-col border-b border-border"
      data-testid="now-playing-source"
      data-station-active={station ? "true" : "false"}
    >
      {station ? (
        <div className="flex w-full flex-col" data-testid="sid-radio-chip">
          <div className={cn("flex items-center gap-2", ROW_HEIGHT)}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
              data-testid="sid-radio-chip-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <Radio className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium text-foreground">
                {stationName(station, friendlyNames)}
              </span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              data-testid="sid-radio-stop"
              aria-label="Stop radio"
              title="Stop radio"
              onClick={onStop}
            >
              Stop
            </Button>
          </div>
          {expanded && whyThisTune ? (
            <p className="pb-2 pl-6 text-xs text-muted-foreground" data-testid="sid-radio-why">
              {whyThisTune}
            </p>
          ) : null}
        </div>
      ) : (
        <div className={cn("flex items-center gap-2", ROW_HEIGHT)} data-testid="now-playing-source-idle">
          <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
          {/* "Your playlist", not "Playlist": the panel below this card is already headed Playlist, and
              two identical labels one above the other read as a mistake. This phrasing also sits
              parallel to the station state, which names a thing ("Melodic Radio") rather than
              labelling a section. */}
          <span className="truncate text-sm text-muted-foreground">Your playlist</span>
        </div>
      )}
    </div>
  );
};
