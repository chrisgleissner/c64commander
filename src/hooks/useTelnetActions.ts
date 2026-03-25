/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";
import { isNativePlatform } from "@/lib/native/platform";
import { withTelnetInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { createActionExecutor } from "@/lib/telnet/telnetActionExecutor";
import { createTelnetClient } from "@/lib/telnet/telnetClient";
import { TELNET_ACTIONS } from "@/lib/telnet/telnetTypes";
import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { getPassword } from "@/lib/secureStorage";
import { addLog } from "@/lib/logging";
import { nextCorrelationId } from "@/lib/tracing/traceIds";

const LOG_TAG = "useTelnetActions";

/** Whether Telnet actions are available on this platform */
export function isTelnetAvailable(): boolean {
  return isNativePlatform();
}

export interface TelnetActionsState {
  /** Whether any Telnet action is currently executing */
  isBusy: boolean;
  /** The ID of the currently executing action, or null */
  activeActionId: string | null;
  /** Execute a Telnet action by ID */
  executeAction: (actionId: string) => Promise<void>;
  /** Whether Telnet is available on this platform */
  isAvailable: boolean;
}

/**
 * React hook providing Telnet action execution with loading state management.
 *
 * Handles session creation, scheduling via withTelnetInteraction, and
 * busy state tracking. All Telnet-only buttons should use this hook
 * for consistent behavior.
 */
export function useTelnetActions(): TelnetActionsState {
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const inflightRef = useRef<string | null>(null);
  const isAvailable = isTelnetAvailable();

  const executeAction = useCallback(async (actionId: string) => {
    if (inflightRef.current !== null) return;
    inflightRef.current = actionId;
    setActiveActionId(actionId);

    try {
      const action = TELNET_ACTIONS[actionId];
      if (!action) {
        throw new Error(`Unknown Telnet action: ${actionId}`);
      }

      await withTelnetInteraction(
        {
          action: {
            correlationId: nextCorrelationId(),
            origin: "user",
            name: `telnet:${actionId}`,
          },
          actionId,
          intent: "user",
        },
        async () => {
          const host = resolveDeviceHostFromStorage();
          const password = await getPassword();
          const transport = createTelnetClient();
          const session = createTelnetSession(transport);

          try {
            await session.connect(host, 23, password ?? undefined);
            const executor = createActionExecutor(session);
            await executor.execute(actionId);
          } finally {
            await session.disconnect();
          }
        },
      );
    } catch (error) {
      addLog("error", `${LOG_TAG}: action "${actionId}" failed`, {
        error: (error as Error).message,
      });
      throw error;
    } finally {
      if (inflightRef.current === actionId) {
        inflightRef.current = null;
      }
      setActiveActionId(null);
    }
  }, []);

  return {
    isBusy: activeActionId !== null,
    activeActionId,
    executeAction,
    isAvailable,
  };
}
