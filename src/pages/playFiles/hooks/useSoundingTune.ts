/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { PlaylistItem } from "@/pages/playFiles/types";

export type SoundingTune = {
  soundingTuneRef: MutableRefObject<PlaylistItem | null>;
  soundingTune: PlaylistItem | null;
  setSoundingTune: (tune: PlaylistItem | null) => void;
};

/**
 * The tune sounding now, exactly as it was launched; null while a change is in progress or nothing sounds.
 *
 * Clock rule: while this is set, trackStartedAtRef is null or the start of this very tune. The ref is written
 * first, as for the other playback refs, so handlers read the value this render has not seen yet.
 */
export function useSoundingTune(): SoundingTune {
  const soundingTuneRef = useRef<PlaylistItem | null>(null);
  const [soundingTune, setState] = useState<PlaylistItem | null>(null);
  const setSoundingTune = useCallback((tune: PlaylistItem | null) => {
    soundingTuneRef.current = tune;
    setState(tune);
  }, []);
  return { soundingTuneRef, soundingTune, setSoundingTune };
}
