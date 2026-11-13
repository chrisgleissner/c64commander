/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback } from "react";

import { toast } from "@/hooks/use-toast";
import { getC64API } from "@/lib/c64api";
import { addErrorLog, buildErrorLogDetails } from "@/lib/logging";
import { basicCommandToPetscii, type BasicCommand } from "@/lib/remoteInput/basicCommands";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";

/** Types a BASIC command and RETURN on the C64 through the shared keyboard-buffer queue. */
export const useBasicCommands = () =>
  useCallback((command: BasicCommand) => {
    void enqueueKeyboardBufferInjection(getC64API(), basicCommandToPetscii(command)).catch((error) => {
      addErrorLog(
        "Remote input BASIC command injection failed",
        buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { command: command.text }),
      );
      toast({ title: `Could not send ${command.text}`, variant: "destructive" });
    });
  }, []);
