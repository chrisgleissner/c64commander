/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatTime } from "@/pages/playFiles/playFilesUtils";
import { useFileTunes } from "@/pages/playFiles/hooks/useFileTunes";

export type TuneListSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The file whose tunes these are, for the subtitle. */
  fileLabel: string;
  /** The HVSC path, or null when the file did not come from HVSC and has no names or lengths. */
  virtualPath: string | null;
  tuneCount: number;
  /** Which tune is playing, so the list says where you are. */
  currentSongNr: number;
  onSelectTune: (songNr: number) => void;
};

/**
 * The tunes inside one SID file, as a list you can choose from.
 *
 * The credits line already said "Tune 3 of 19", which states that eighteen others exist and gives
 * no way to reach them. This is the way: the same gesture as the composer beside it — an underlined
 * fact that turns out to be a door.
 *
 * It is not the same as "Play all N tunes", and both are worth having. That one queues the whole
 * file to listen through; this one is for going straight to a particular tune, which is what you
 * want when the good one is number twelve.
 */
export const TuneListSheet = ({
  open,
  onOpenChange,
  fileLabel,
  virtualPath,
  tuneCount,
  currentSongNr,
  onSelectTune,
}: TuneListSheetProps) => {
  const { tunes } = useFileTunes({ virtualPath, tuneCount, enabled: open });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex flex-col" data-testid="tune-list-sheet">
        <SheetHeader className="pb-0">
          <SheetTitle className="text-base">Tunes in this file</SheetTitle>
          <SheetDescription className="truncate">{fileLabel}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pt-2">
          {/* Same spacing as the search results, because these are the same kind of row and one
              tap does the same kind of thing. */}
          <ul className="flex flex-col gap-2">
            {tunes.map((tune) => {
              const isCurrent = tune.songNr === currentSongNr;
              return (
                <li key={tune.songNr}>
                  <Button
                    type="button"
                    variant={isCurrent ? "secondary" : "ghost"}
                    className={cn(
                      "flex h-auto w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left",
                      isCurrent ? "border-primary/50" : "border-border/60",
                    )}
                    data-testid="tune-list-row"
                    data-song-nr={tune.songNr}
                    data-current={isCurrent ? "true" : undefined}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => onSelectTune(tune.songNr)}
                  >
                    <Play className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-medium">
                        {/* The number always leads: it is the only thing every tune has, and it is
                            what the credits line and the playlist rows both use.

                            The number alone, not "Tune 12". The sheet is titled "Tunes in this
                            file", so the word was repeated on every row and said nothing the header
                            had not; on the smallest supported screen it took about five characters
                            of width off the tune's name, which is the part that is actually worth
                            reading. */}
                        {tune.songNr}
                        {tune.title ? <span className="font-normal"> · {tune.title}</span> : null}
                      </span>
                    </span>
                    {/* Left blank rather than filled with the three-minute default, which is what
                        an unknown length falls back to and would be a wrong number rather than no
                        number. */}
                    {tune.durationMs === null ? null : (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatTime(tune.durationMs)}
                      </span>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
};
