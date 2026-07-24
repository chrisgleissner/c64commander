/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Heart, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNowPlayingRanking } from "@/lib/sidRadio/useNowPlayingRanking";

export type NowPlayingRankingProps = {
  /** Full MD5 of the current tune; null while unresolved or for non-SID items. */
  md5: string | null;
  /** Whether the affordance is shown (sidRadioEnabled && sidRankingEnabled). */
  enabled: boolean;
  /**
   * Called when the user *newly* marks the tune Not-for-me while a station is
   * active — the station skips immediately (spec §5.1, D8). Omitted (or no
   * active station) → ✕ only records the dislike.
   */
  onNotForMe?: () => void;
};

/**
 * The ambient ♥ / ✕ ranking pair on the Now Playing card (spec §5.1). Toast-free,
 * single-tap, never interrupts playback. Hidden when disabled; buttons disabled
 * until the tune's MD5 is resolved.
 */
export const NowPlayingRanking = ({ md5, enabled, onNotForMe }: NowPlayingRankingProps) => {
  const { isLiked, isNotForMe, toggleLike, toggleNotForMe } = useNowPlayingRanking(md5);

  if (!enabled) return null;
  const disabled = !md5;

  return (
    <div className="flex items-center gap-1" data-testid="now-playing-ranking">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        data-testid="now-playing-like"
        aria-pressed={isLiked}
        aria-label={isLiked ? "Remove like" : "Like this tune"}
        title={isLiked ? "Remove like" : "Like this tune"}
        disabled={disabled}
        onClick={toggleLike}
      >
        <Heart className={cn("transition-colors", isLiked && "fill-current text-rose-500")} />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        data-testid="now-playing-notforme"
        aria-pressed={isNotForMe}
        aria-label={isNotForMe ? "Undo not-for-me" : "Not for me"}
        title={isNotForMe ? "Undo not-for-me" : "Not for me"}
        disabled={disabled}
        onClick={() => {
          const nowMarked = toggleNotForMe();
          if (nowMarked) onNotForMe?.();
        }}
      >
        <X className={cn("transition-colors", isNotForMe && "text-foreground")} />
      </Button>
    </div>
  );
};
