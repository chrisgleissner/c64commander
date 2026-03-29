/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";
import { isNativePlatform } from "@/lib/native/platform";
import { useC64Connection } from "@/hooks/useC64Connection";
import { withTelnetInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { createActionExecutor } from "@/lib/telnet/telnetActionExecutor";
import { createTelnetClient, shouldUseMockTelnetTransport } from "@/lib/telnet/telnetClient";
import {
  isTelnetCapableProduct,
  resolveTelnetMenuKey,
  TELNET_ACTIONS,
  type TelnetMenuKey,
} from "@/lib/telnet/telnetTypes";
import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { getPassword } from "@/lib/secureStorage";
import { addLog } from "@/lib/logging";
import { createActionContext, runWithActionTrace } from "@/lib/tracing/actionTrace";
import { recordTelnetOperation } from "@/lib/tracing/traceSession";
import { decrementTelnetInFlight, incrementTelnetInFlight } from "@/lib/diagnostics/diagnosticsActivity";
import { getStoredTelnetPort } from "@/lib/telnet/telnetConfig";

const LOG_TAG = "useTelnetActions";

type TelnetCapabilityDecision = {
  isAvailable: boolean;
  menuKey: TelnetMenuKey | null;
};

const resolveTelnetCapability = ({
  nativePlatform = isNativePlatform(),
  isConnected = false,
  isDemo = false,
  product = null,
  mockTarget = shouldUseMockTelnetTransport(),
}: {
  nativePlatform?: boolean;
  isConnected?: boolean;
  isDemo?: boolean;
  product?: string | null;
  mockTarget?: boolean;
} = {}): TelnetCapabilityDecision => {
  const menuKey = resolveTelnetMenuKey(product);
  if ((!nativePlatform && !mockTarget) || !isConnected || !isTelnetCapableProduct(product)) {
    return {
      isAvailable: false,
      menuKey,
    };
  }
  if (isDemo && !mockTarget) {
    return {
      isAvailable: false,
      menuKey,
    };
  }
  return {
    isAvailable: true,
    menuKey,
  };
};

/** Whether Telnet actions are available for the current device context. */
export function isTelnetAvailable(options?: {
  nativePlatform?: boolean;
  isConnected?: boolean;
  isDemo?: boolean;
  product?: string | null;
  mockTarget?: boolean;
}): boolean {
  return resolveTelnetCapability(options).isAvailable;
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
  const { status } = useC64Connection();
  const capability = resolveTelnetCapability({
    isConnected: status.isConnected,
    isDemo: status.isDemo,
    product: status.deviceInfo?.product,
  });
  const isAvailable = capability.isAvailable;

  const executeAction = useCallback(
    async (actionId: string) => {
      if (inflightRef.current !== null) return;
      const action = TELNET_ACTIONS[actionId as keyof typeof TELNET_ACTIONS];
      if (!action) {
        throw new Error(`Unknown Telnet action: ${actionId}`);
      }
      if (!capability.isAvailable || capability.menuKey === null) {
        throw new Error("Telnet is unavailable for the current device");
      }

      const traceAction = createActionContext(`Telnet ${action.label}`, "user", LOG_TAG);
      inflightRef.current = actionId;
      setActiveActionId(actionId);
      incrementTelnetInFlight();

      try {
        await runWithActionTrace(traceAction, async () => {
          const startedAt = Date.now();
          try {
            await withTelnetInteraction(
              {
                action: traceAction,
                actionId,
                intent: "user",
              },
              async () => {
                const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
                const port = getStoredTelnetPort();
                const password = await getPassword();
                const transport = createTelnetClient();
                const session = createTelnetSession(transport);

                try {
                  await session.connect(host, port, password ?? undefined);
                  const executor = createActionExecutor(session, { menuKey: capability.menuKey ?? undefined });
                  await executor.execute(actionId);
                } finally {
                  await session.disconnect();
                }
              },
            );

            recordTelnetOperation(traceAction, {
              actionId: action.id,
              actionLabel: action.label,
              menuPath: action.menuPath,
              durationMs: Date.now() - startedAt,
              result: "success",
              error: null,
            });
          } catch (error) {
            const resolvedError = error as Error;
            recordTelnetOperation(traceAction, {
              actionId: action.id,
              actionLabel: action.label,
              menuPath: action.menuPath,
              durationMs: Date.now() - startedAt,
              result: "failure",
              error: resolvedError,
            });
            throw resolvedError;
          }
        });
      } catch (error) {
        addLog("error", `${LOG_TAG}: action "${actionId}" failed`, {
          error: (error as Error).message,
        });
        throw error;
      } finally {
        decrementTelnetInFlight();
        if (inflightRef.current === actionId) {
          inflightRef.current = null;
        }
        setActiveActionId(null);
      }
    },
    [capability.isAvailable, capability.menuKey],
  );

  return {
    isBusy: activeActionId !== null,
    activeActionId,
    executeAction,
    isAvailable,
  };
}
