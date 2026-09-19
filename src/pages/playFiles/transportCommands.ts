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
  isPaused: boolean;
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
    // HARD27-007: a paused session still has isPlaying true, so the old "start only when nothing is
    // playing" rule made a headset or lock-screen Play a no-op exactly when the user meant resume.
    if (handlers.isPaused) handlers.pauseResume();
    else if (!handlers.isPlaying) handlers.play();
  } else if (!handlers.isPlaying && !handlers.isPaused) {
    // Play/Pause with nothing playing means start, the way a media key always has. It fell straight
    // through to pauseResume, which on an idle session does nothing: pressing the handset's F1 key
    // on Home navigated to Play and left the user looking at a stopped transport.
    handlers.play();
  } else handlers.pauseResume();
};
