/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { stringToPetsciiBytes } from "@/lib/remoteInput/kernalFallbackEncoding";

export interface BasicCommand {
  readonly id: string;
  readonly text: string;
}

export const BASIC_COMMANDS: readonly BasicCommand[] = [
  { id: "list", text: "LIST" },
  { id: "run", text: "RUN" },
  { id: "load-directory", text: 'LOAD"$",8' },
  { id: "load-first-program", text: 'LOAD"*",8,1' },
];

export const BASIC_COMMANDS_HINT = "These work at the BASIC prompt.";

export const basicCommandToPetscii = (command: BasicCommand): Uint8Array => stringToPetsciiBytes(`${command.text}\r`);
