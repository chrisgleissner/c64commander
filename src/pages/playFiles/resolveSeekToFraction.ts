/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaybackSeekHandlers } from "@/pages/playFiles/hooks/useRemoteSidSeek";

export type SeekToFractionInputs = {
  category: PlayFileCategory | undefined;
  /** The C64's own seek, present only on a machine and tune that support it. */
  remoteHandlers: PlaybackSeekHandlers | null;
  localEngineActive: boolean;
  durationMs: number | undefined;
  seekLocal: (fraction: number, durationMs: number) => void;
};

/**
 * Where a drag to a fraction of the tune goes, or undefined when this tune cannot be seeked. The
 * transport's seek bar and the lock-screen control both read this one answer, so the lock screen
 * never offers a seek the Play page would not.
 */
export const resolveSeekToFraction = ({
  category,
  remoteHandlers,
  localEngineActive,
  durationMs,
  seekLocal,
}: SeekToFractionInputs): ((fraction: number) => void) | undefined => {
  if (category !== "sid") return undefined;
  if (remoteHandlers) return remoteHandlers.onSeekToFraction;
  if (!localEngineActive || !durationMs) return undefined;
  return (fraction) => seekLocal(fraction, durationMs);
};
