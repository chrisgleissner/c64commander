/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useTransportCommands } from "@/pages/playFiles/hooks/usePlayDeepLinks";
import { runTransportCommand, type TransportCommandHandlers } from "@/pages/playFiles/transportCommands";

/**
 * F1 and F3 from anywhere, delivered through the latch (spec.md 9.5). Held until `ready`: the stored
 * playlist is restored in an effect declared after the page's call to this hook, so a command drained
 * on mount ran against an empty playlist and did nothing.
 *
 * HARD27-032: the page also holds it until the stored session has been applied. The session survives
 * process death, so the Home "Last" tile can arrive at a page that has its playlist but not yet its
 * paused position, and a "play" drained there sees isPaused false and restarts the tune from the
 * beginning instead of resuming where the user left off.
 */
export const usePlayTransportCommands = (handlers: TransportCommandHandlers, ready: boolean): void =>
  useTransportCommands((command) => runTransportCommand(command, handlers), ready);
