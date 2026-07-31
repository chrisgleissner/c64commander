/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { CircleX, Heart, X } from "lucide-react";

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
   *
   * Its presence is therefore also how this component knows a station is
   * driving the queue, which is what decides whether ✕ says it will skip.
   */
  onNotForMe?: () => void;
};

/**
 * The ♥ / ✕ ranking pair on the Now Playing card (spec §5.1) — two primary CTAs, not decoration.
 *
 * **Order: ✕ then ♥, with ♥ outermost.** The pair is right-aligned, so the outermost button is the
 * easiest one to hit on the row — and it shares its right edge with the Next button one row below,
 * which is where an overshooting thumb ends up. ♥ takes that seat because it is the safe half of
 * the pair: a stray ♥ fills a heart you can see and untap, whereas a stray ✕ skips the tune out
 * from under you *and* biases every future refill, and the tune it was about has left the card
 * before you can undo it. Left-to-right this reads reject-then-like, matching the
 * swipe-left-to-reject / swipe-right-to-like mapping that mobile has taught everyone for
 * one-at-a-time item streams, which is exactly what a station is.
 *
 * **Weight: the same 44 px outline button as the transport.** These were 32 px ghost glyphs, which
 * put them under the project's own 40 px hit-target floor and made them read as decoration beside
 * four chromed transport buttons. Chrome does a second job for the ✕: `docs/ux-guidelines.md`
 * defines the app's shared close control as a plain × with *no* button chrome, so putting this ×
 * in a bordered button is what stops it being read as "dismiss this card".
 *
 * **State is never carried by colour alone.** ♥ fills its glyph solid and tints its surface; ✕
 * swaps to a circled glyph and takes the same filled-surface treatment the Reshuffle toggle uses
 * for "on". Both survive greyscale, and `aria-pressed` plus a label that changes carry it to
 * assistive technology.
 *
 * Deliberately *not* added: a confirmation step (it would break a lean-back radio, and no station
 * player confirms a thumb-down) and an undo toast (the toast viewport is a fixed overlay sitting
 * directly over this card's transport, and has already swallowed taps there). The protection is
 * structural instead — a bigger target, unambiguous chrome, and the destructive half moved off the
 * seat a thumb reaches first.
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
        className={cn(isNotForMe && "border-accent bg-accent text-accent-foreground")}
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
        {isNotForMe ? <CircleX /> : <X />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={cn(isLiked && "border-rose-500/60 bg-rose-500/15 text-rose-500")}
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
