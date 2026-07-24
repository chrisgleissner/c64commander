/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState } from "react";

import {
  loadLocalEngineEnabled,
  loadPlaybackEngine,
  savePlaybackEngine,
  type PlaybackEngine,
} from "@/lib/config/appSettings";

export interface PlaybackEngineState {
  /** The persisted playback engine (`c64` | `local`). */
  engine: PlaybackEngine;
  /** True when the on-device engine is offered at all (rollout gate). */
  localEngineEnabled: boolean;
  /** Persist a new engine choice (broadcasts to other subscribers). */
  setEngine: (engine: PlaybackEngine) => void;
}

const read = () => ({
  engine: loadPlaybackEngine(),
  localEngineEnabled: loadLocalEngineEnabled(),
});

/** Reactive playback-engine selection (re-reads on the app-settings broadcast). */
export const usePlaybackEngine = (): PlaybackEngineState => {
  const [state, setState] = useState(read);
  useEffect(() => {
    const handler = () => setState(read());
    window.addEventListener("c64u-app-settings-updated", handler);
    return () => window.removeEventListener("c64u-app-settings-updated", handler);
  }, []);
  const setEngine = useCallback((engine: PlaybackEngine) => savePlaybackEngine(engine), []);
  return { ...state, setEngine };
};
