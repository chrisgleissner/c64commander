/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { usePageActivity } from "@/hooks/usePageActivity";
import { useRunAtTime } from "@/pages/playFiles/hooks/useRunAtTime";
import { useSecondAlignedTicks } from "@/pages/playFiles/hooks/useSecondAlignedTicks";

type PlaybackTimelineTicks = {
  /** Brings the timeline up to date and renders it; also advances a tune that is due. */
  tick: (shownAtMs: number) => void;
  running: boolean;
  startedAtRef: { readonly current: number | null };
  autoAdvanceDueAtMs: number | null;
};

/**
 * The Play page's timeline: re-rendered as each second turns while the page is on screen. While another tab is, the
 * page is kept but not shown, so it is not re-rendered every second; the timeline is brought up to date again at once
 * when the page is shown. In both cases it is brought up to date at the moment the next tune is due, not at the next
 * second: a crossfade at the natural end needs the next tune started on time, and a tick up to a second late shortened
 * the outgoing tune's fade.
 */
export const usePlaybackTimelineTicks = ({
  tick,
  running,
  startedAtRef,
  autoAdvanceDueAtMs,
}: PlaybackTimelineTicks) => {
  const pageActive = usePageActivity();
  useSecondAlignedTicks(tick, running && pageActive, startedAtRef);
  useRunAtTime(() => tick(Date.now()), running ? autoAdvanceDueAtMs : null);
};
