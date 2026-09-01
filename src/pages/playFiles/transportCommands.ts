/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TransportCommand } from "@/lib/input/latchedCommandBus";

export interface TransportCommandHandlers {
  isPlaying: boolean;
  play: () => void;
  pauseResume: () => void;
  next: () => void;
  stop: () => void;
}

/**
 * What each transport command does on Play. The same commands arrive from F1/F3, from search and
 * from the Android media buttons, so the mapping lives here where a test can drive it directly.
 */
export const runTransportCommand = (command: TransportCommand, handlers: TransportCommandHandlers): void => {
  if (command === "next") handlers.next();
  else if (command === "stop") handlers.stop();
  else if (command === "play") {
    if (!handlers.isPlaying) handlers.play();
  } else handlers.pauseResume();
};
