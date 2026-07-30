/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { HeartOff, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { buildLikedTunePlaylistItems, listLikedTunes, type LikedTuneEntry } from "@/lib/sidRadio/likedTunes";
import { clearRanking, subscribeRankings } from "@/lib/sidRadio/rankingStore";
import { SidChipBadge } from "@/components/playback/SidChipBadge";
import { resolveTrackDisplayName } from "@/lib/playback/sidDisplayName";
import { useFriendlySidNames } from "@/lib/playback/useFriendlySidNames";

export type LikedTunesListProps = {
  /** Play the (finite) Liked Tunes list starting at the tapped tune. */
  onPlay: (items: PlaylistItem[], startIndex: number) => void;
  /** Predicate to prefer an installed HVSC path when a md5_48 maps to several (D14). */
  isInstalled?: (virtualPath: string) => boolean;
};

/**
 * Browsable, playable Liked Tunes collection (spec §5.5). A **finite list**, not
 * a radio: `onPlay` routes through the existing `startPlaylist`, so normal
 * Shuffle/Repeat apply. Rows can be un-liked (drops from the list *and* stops
 * steering); tunes not in the installed HVSC are greyed, not dropped (§2.5).
 */
export const LikedTunesList = ({ onPlay, isInstalled }: LikedTunesListProps) => {
  const [entries, setEntries] = useState<LikedTuneEntry[]>(() => listLikedTunes({ isInstalled }));
  const friendlyNames = useFriendlySidNames();

  useEffect(() => {
    const refresh = () => setEntries(listLikedTunes({ isInstalled }));
    refresh();
    return subscribeRankings(refresh);
  }, [isInstalled]);

  const playItems = useMemo(() => buildLikedTunePlaylistItems(entries), [entries]);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="liked-tunes">
        No liked tunes yet. Tap ♥ while a tune plays to add it here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="liked-tunes">
      {entries.map((entry) => {
        const playIndex = entry.virtualPath ? playItems.findIndex((item) => item.path === entry.virtualPath) : -1;
        // An unresolved entry's label is "Unknown tune (<md5>)", not a file name, so it is left
        // alone: the beautifier reads a file-naming convention and this is a diagnostic string.
        // Entries are still sorted on the raw label in `listLikedTunes`, so the order does not move
        // when the preference changes.
        const display = entry.virtualPath
          ? resolveTrackDisplayName({ label: entry.label, category: "sid", friendlyNames })
          : { title: entry.label, chipCount: null };
        return (
          <li
            key={entry.md5}
            data-testid="liked-tune-row"
            className={cn(
              "flex items-center gap-2 rounded-md border border-border/60 px-2 py-1",
              !entry.resolved && "opacity-50",
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start gap-2"
              data-testid="liked-tune-play"
              disabled={!entry.resolved || playIndex < 0}
              onClick={() => onPlay(playItems, playIndex)}
              title={entry.resolved ? `Play from ${display.title}` : "Not in the installed HVSC"}
            >
              <Play className="shrink-0" />
              <span className="truncate">{display.title}</span>
              {display.chipCount ? <SidChipBadge chipCount={display.chipCount} /> : null}
            </Button>
            {!entry.resolved ? (
              <span className="shrink-0 text-xs text-muted-foreground">not in current HVSC</span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              data-testid="liked-tune-unlike"
              aria-label={`Un-like ${display.title}`}
              title="Un-like"
              onClick={() => void clearRanking(entry.md5)}
            >
              <HeartOff />
            </Button>
          </li>
        );
      })}
    </ul>
  );
};
