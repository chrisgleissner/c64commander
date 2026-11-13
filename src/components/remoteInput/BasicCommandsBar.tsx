/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { BASIC_COMMANDS, BASIC_COMMANDS_HINT, type BasicCommand } from "@/lib/remoteInput/basicCommands";

export interface BasicCommandsBarProps {
  onCommand: (command: BasicCommand) => void;
}

export const BasicCommandsBar = ({ onCommand }: BasicCommandsBarProps) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex shrink-0 flex-col gap-2 px-4" data-testid="remote-input-basic-commands">
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 justify-between text-base"
        aria-expanded={open}
        data-testid="remote-input-basic-commands-toggle"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        BASIC commands
      </Button>
      {open ? (
        <>
          <p className="text-base text-muted-foreground" data-testid="remote-input-basic-commands-hint">
            {BASIC_COMMANDS_HINT}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {BASIC_COMMANDS.map((command) => (
              <Button
                key={command.id}
                type="button"
                variant="outline"
                className="min-h-11 font-mono text-base"
                data-testid={`remote-input-basic-command-${command.id}`}
                onClick={() => onCommand(command)}
              >
                {command.text}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};
