/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ComponentProps } from "react";
import { Progress } from "@/components/ui/progress";
import { usePlaybackTime } from "@/pages/playFiles/playbackTimeStore";
import type { PlaybackTimeDisplay, PlaybackTimeline } from "@/pages/playFiles/playbackTimeline";

/** What the timeline shows now, re-rendering only the caller as the time moves. */
const useShownPlaybackTime = (timeline: PlaybackTimeline): PlaybackTimeDisplay =>
  timeline.display(usePlaybackTime(timeline.playbackTime).elapsedMs);

/** The timeline's display as it stands, for an event handler that needs it without following it. */
export const readShownPlaybackTime = (timeline: PlaybackTimeline): PlaybackTimeDisplay =>
  timeline.display(timeline.playbackTime.read().elapsedMs);

export const ShownPlaybackTime = ({
  timeline,
  field,
}: {
  timeline: PlaybackTimeline;
  field: Exclude<keyof PlaybackTimeDisplay, "progressPercent">;
}) => <>{useShownPlaybackTime(timeline)[field]}</>;

export const ShownPlaybackProgress = ({
  timeline,
  ...props
}: { timeline: PlaybackTimeline } & Omit<ComponentProps<typeof Progress>, "value">) => (
  <Progress {...props} value={useShownPlaybackTime(timeline).progressPercent} />
);
