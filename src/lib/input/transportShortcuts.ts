/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { transportCommandBus } from "@/lib/input/latchedCommandBus";
import type { TransportCommand } from "@/lib/input/latchedCommandBus";

/** Where the transport controls live. A press anywhere else has to go there first. */
export const TRANSPORT_PATH = "/play";

export interface TransportShortcutOptions {
  navigate: (path: string) => void;
  currentPath: () => string;
}

/**
 * What F1 and F3 do (spec.md section 9.5).
 *
 * The command is latched as well as dispatched, so a press on a page with no transport survives the
 * navigation to Play and is drained when Play mounts. Extracted from App so a test can drive the
 * production wiring rather than a copy of it.
 */
export const createTransportShortcut =
  (command: TransportCommand, options: TransportShortcutOptions) => (): void => {
    transportCommandBus.publish(command);
    if (options.currentPath() !== TRANSPORT_PATH) options.navigate(TRANSPORT_PATH);
  };
