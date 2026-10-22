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
   * active station) → the thumbs-down only records the dislike.
   *
   * Its presence is therefore also how this component knows a station is
   * driving the queue, which is what decides whether ✕ says it will skip.
   */
  onNotForMe?: () => void;
};

/** Neutral Not-for-me cross and heart, beside the current tune's facts.
 * Both share the mode buttons' outline, 44px target and 20px icon. Selected surfaces,
 * a dot on the cross and a filled heart expose state without relying on colour alone.
 */
export const NowPlayingRanking = ({ md5, enabled, onNotForMe }: NowPlayingRankingProps) => {
  const { isLiked, isNotForMe, toggleLike, toggleNotForMe } = useNowPlayingRanking(md5);

  if (!enabled) return null;
  const disabled = !md5;

  // Say what the button does, not what it looks like: a listener who cannot see the card has no way
  // to know from "Not for me" that the tune is about to stop playing.
  const notForMeLabel = isNotForMe
    ? "Undo not for me"
    : onNotForMe
      ? "Not for me — skip and play less like this"
      : "Not for me — play less like this";
  const likeLabel = isLiked ? "Remove like" : "Like this tune — play more like this";

  return (
    <div className="flex items-center gap-2" data-testid="now-playing-ranking">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={cn(
          "relative size-[44px] min-h-[44px] min-w-[44px] [&_svg]:size-[20px]",
          isNotForMe && "border-accent bg-accent text-accent-foreground",
        )}
        data-testid="now-playing-notforme"
        aria-pressed={isNotForMe}
        aria-label={notForMeLabel}
        title={notForMeLabel}
        disabled={disabled}
        onClick={() => {
          const nowMarked = toggleNotForMe();
          if (nowMarked) onNotForMe?.();
        }}
      >
        <X aria-hidden="true" />
        {isNotForMe ? (
          <span
            data-testid="notforme-active"
            aria-hidden="true"
            className="absolute bottom-1 size-1 rounded-full bg-current"
          />
        ) : null}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={cn(
          "size-[44px] min-h-[44px] min-w-[44px] [&_svg]:size-[20px]",
          isLiked && "border-accent/60 bg-accent/15 text-accent",
        )}
        data-testid="now-playing-like"
        aria-pressed={isLiked}
        aria-label={likeLabel}
        title={likeLabel}
        disabled={disabled}
        onClick={toggleLike}
      >
        <Heart className={cn("transition-colors", isLiked && "fill-current")} />
      </Button>
    </div>
  );
};
