/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { isAudioFxAvailable, probeAudioFx } from "@/lib/native/audioFx";

/**
 * Whether this phone can analyse and process its own sound. True at once when the plugin is
 * present, and corrected after the one-time probe if the plugin turns out to lack the calls.
 */
export const useAudioFxAvailable = (): boolean => {
  const [available, setAvailable] = useState(isAudioFxAvailable);
  useEffect(() => {
    let current = true;
    void probeAudioFx().then((result) => {
      if (current) setAvailable(result);
    });
    return () => {
      current = false;
    };
  }, []);
  return available;
};
