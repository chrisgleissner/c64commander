/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TelnetSessionApi, TelnetAction } from "@/lib/telnet/telnetTypes";
import { TELNET_ACTIONS, TelnetError } from "@/lib/telnet/telnetTypes";
import { createMenuNavigator } from "@/lib/telnet/telnetMenuNavigator";
import type { MenuNavigator } from "@/lib/telnet/telnetMenuNavigator";
import { addLog } from "@/lib/logging";

const LOG_TAG = "TelnetActionExecutor";

export interface TelnetActionExecutor {
  /** Execute a Telnet-only action by its ID (e.g., 'powerCycle') */
  execute(actionId: string): Promise<void>;

  /** Get the action definition for a given ID, or null if unknown */
  getAction(actionId: string): TelnetAction | null;

  /** List all available Telnet-only actions */
  listActions(): TelnetAction[];
}

/**
 * Creates a high-level action executor that:
 * 1. Looks up action by ID in the TELNET_ACTIONS registry
 * 2. Delegates to the menu navigator for label-based navigation
 * 3. Detects device type for correct F-key (F5 for U64, F1 for C64U)
 *
 * Scheduling is NOT handled here — callers must wrap in withTelnetInteraction().
 */
export function createActionExecutor(
  session: TelnetSessionApi,
  options?: { menuKey?: "F5" | "F1" },
): TelnetActionExecutor {
  const navigator: MenuNavigator = createMenuNavigator(session);
  const menuKey = options?.menuKey ?? "F5";

  async function execute(actionId: string): Promise<void> {
    const action = TELNET_ACTIONS[actionId];
    if (!action) {
      throw new TelnetError(
        `Unknown Telnet action: "${actionId}". Available: [${Object.keys(TELNET_ACTIONS).join(", ")}]`,
        "ACTION_FAILED",
        { actionId },
      );
    }

    const startTime = Date.now();
    addLog("info", `${LOG_TAG}: executing action "${action.label}" (${actionId})`, {
      menuPath: action.menuPath,
      subsystem: action.subsystem,
      menuKey,
    });

    try {
      await navigator.navigate(action.menuPath, menuKey);

      addLog("info", `${LOG_TAG}: action "${action.label}" completed`, {
        actionId,
        elapsed: Date.now() - startTime,
      });
    } catch (error) {
      addLog("error", `${LOG_TAG}: action "${action.label}" failed`, {
        actionId,
        elapsed: Date.now() - startTime,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  function getAction(actionId: string): TelnetAction | null {
    return TELNET_ACTIONS[actionId] ?? null;
  }

  function listActions(): TelnetAction[] {
    return Object.values(TELNET_ACTIONS);
  }

  return { execute, getAction, listActions };
}
