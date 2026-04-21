/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isNativePlatform } from "@/lib/native/platform";
import { useC64Connection } from "@/hooks/useC64Connection";
import { withTelnetInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { createActionExecutor } from "@/lib/telnet/telnetActionExecutor";
import { createTelnetClient, shouldUseMockTelnetTransport } from "@/lib/telnet/telnetClient";
import {
  buildTelnetCapabilityCacheKey,
  discoverTelnetCapabilities,
  type TelnetActionSupport,
  type TelnetCapabilitySnapshot,
} from "@/lib/telnet/telnetCapabilityDiscovery";
import {
  isTelnetCapableProduct,
  resolveTelnetMenuKey,
  TELNET_ACTIONS,
  TELNET_ACTION_IDS,
  type TelnetMenuKey,
  TelnetError,
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
  /** Current discovery state for per-action support */
  discoveryState: "idle" | "loading" | "ready" | "error";
  /** Discovery error message when capability discovery fails */
  discoveryError: string | null;
  /** Per-action support derived from the discovered Telnet menu graph */
  actionSupport: Record<string, TelnetActionSupport>;
  /** Return support information for one action */
  getActionSupport: (actionId: string) => TelnetActionSupport;
}

const buildFallbackActionSupport = (
  status: "unsupported" | "unknown",
  reason: string,
): Record<string, TelnetActionSupport> =>
  Object.fromEntries(
    TELNET_ACTION_IDS.map((actionId) => [
      actionId,
      {
        actionId,
        status,
        reason,
        target: null,
      },
    ]),
  );

/**
 * React hook providing Telnet action execution with loading state management.
 *
 * Handles session creation, scheduling via withTelnetInteraction, and
 * busy state tracking. All Telnet-only buttons should use this hook
 * for consistent behavior.
 */
export function useTelnetActions(): TelnetActionsState {
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<TelnetCapabilitySnapshot | null>(null);
  const [discoveryState, setDiscoveryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const inflightRef = useRef<string | null>(null);
  const { status } = useC64Connection();
  const capability = resolveTelnetCapability({
    isConnected: status.isConnected,
    isDemo: status.isDemo,
    product: status.deviceInfo?.product,
  });
  const isAvailable = capability.isAvailable;
  const capabilityCacheKey = capability.menuKey
    ? buildTelnetCapabilityCacheKey(
        status.deviceInfo,
        capability.menuKey,
        stripPortFromDeviceHost(resolveDeviceHostFromStorage()),
      )
    : null;

  const loadCapabilities = useCallback(async () => {
    if (!capability.isAvailable || capability.menuKey === null) {
      throw new TelnetError("Telnet is unavailable for the current device", "UNSUPPORTED_ACTION");
    }
    const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
    const port = getStoredTelnetPort();
    const cacheKey = buildTelnetCapabilityCacheKey(status.deviceInfo, capability.menuKey, host);
    return await discoverTelnetCapabilities({
      cacheKey,
      deviceInfo: status.deviceInfo,
      menuKey: capability.menuKey,
      runner: {
        withSession: async (callback) => {
          const password = await getPassword();
          const transport = createTelnetClient();
          const session = createTelnetSession(transport);
          try {
            await session.connect(host, port, password ?? undefined);
            return await callback(session);
          } finally {
            await session.disconnect();
          }
        },
      },
    });
  }, [capability.isAvailable, capability.menuKey, status.deviceInfo]);

  const fallbackSupport = !status.isConnected
    ? buildFallbackActionSupport("unsupported", "Connect to a C64 Ultimate device to inspect Telnet actions.")
    : !capability.isAvailable
      ? buildFallbackActionSupport("unsupported", "Telnet actions are unavailable on this platform or device.")
      : discoveryState === "loading"
        ? buildFallbackActionSupport("unknown", "Discovering Telnet actions on the connected device.")
        : discoveryError
          ? buildFallbackActionSupport("unknown", `Telnet action discovery failed: ${discoveryError}`)
          : buildFallbackActionSupport("unknown", "Telnet action discovery has not completed yet.");

  const actionSupport = capabilities?.actionSupport ?? fallbackSupport;

  const getActionSupport = useCallback(
    (actionId: string) =>
      actionSupport[actionId] ?? {
        actionId: actionId as never,
        status: "unknown",
        reason: "Unknown Telnet action.",
        target: null,
      },
    [actionSupport],
  );

  useEffect(() => {
    if (!status.isConnected || !capability.isAvailable || capability.menuKey === null || capabilityCacheKey === null) {
      setCapabilities(null);
      setDiscoveryError(null);
      setDiscoveryState("idle");
      return;
    }

    let cancelled = false;
    setDiscoveryState("loading");
    setDiscoveryError(null);

    void loadCapabilities()
      .then((snapshot) => {
        if (cancelled) return;
        setCapabilities(snapshot);
        setDiscoveryState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        const message = (error as Error).message;
        setCapabilities(null);
        setDiscoveryError(message);
        setDiscoveryState("error");
        addLog("error", `${LOG_TAG}: capability discovery failed`, {
          cacheKey: capabilityCacheKey,
          error: message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [capability.isAvailable, capability.menuKey, capabilityCacheKey, loadCapabilities, status.isConnected]);

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
      const discoveredCapabilities = await loadCapabilities();
      const support =
        discoveredCapabilities.actionSupport[actionId as keyof typeof discoveredCapabilities.actionSupport];
      if (!support || support.status !== "supported" || !support.target) {
        throw new TelnetError(
          support?.reason ?? `Unable to resolve Telnet action ${actionId}`,
          support?.status === "unknown" ? "DISCOVERY_FAILED" : "UNSUPPORTED_ACTION",
          { actionId },
        );
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
                  const executor = createActionExecutor(session, {
                    menuKey: capability.menuKey ?? undefined,
                    resolvedTargets: { [action.id]: support.target },
                  });
                  await executor.execute(actionId);
                } finally {
                  await session.disconnect();
                }
              },
            );

            recordTelnetOperation(traceAction, {
              actionId: action.id,
              actionLabel: action.label,
              menuPath: [support.target.categoryLabel, support.target.actionLabel],
              durationMs: Date.now() - startedAt,
              result: "success",
              error: null,
            });
          } catch (error) {
            const resolvedError = error as Error;
            recordTelnetOperation(traceAction, {
              actionId: action.id,
              actionLabel: action.label,
              menuPath: support.target ? [support.target.categoryLabel, support.target.actionLabel] : action.menuPath,
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
    [capability.isAvailable, capability.menuKey, loadCapabilities],
  );

  return {
    isBusy: activeActionId !== null,
    activeActionId,
    executeAction,
    isAvailable,
    discoveryState,
    discoveryError,
    actionSupport,
    getActionSupport,
  };
}
