/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isNativePlatform } from "@/lib/native/platform";
import { useC64Connection } from "@/hooks/useC64Connection";
import { withTelnetInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { createActionExecutor } from "@/lib/telnet/telnetActionExecutor";
import { createTelnetClient, shouldUseMockTelnetTransport } from "@/lib/telnet/telnetClient";
import {
  buildTelnetCapabilityCacheKey,
  discoverTelnetCapabilities,
  getCachedTelnetCapabilities,
  type TelnetActionSupport,
  type TelnetCapabilitySnapshot,
} from "@/lib/telnet/telnetCapabilityDiscovery";
import {
  isTelnetCapableProduct,
  resolveTelnetMenuKey,
  TELNET_ACTIONS,
  TELNET_ACTION_IDS,
  type TelnetMenuKey,
  type TelnetTraceSnapshot,
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
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";

const LOG_TAG = "useTelnetActions";

type TelnetCapabilityDecision = {
  isAvailable: boolean;
  menuKey: TelnetMenuKey | null;
};

type TelnetCapabilityLoadResult = {
  snapshot: TelnetCapabilitySnapshot;
  trace: TelnetTraceSnapshot | null;
};

const buildEmptyTelnetTraceSnapshot = (hostname: string, port: number): TelnetTraceSnapshot => ({
  hostname,
  port,
  requestPayload: { steps: [] },
  responsePayload: { steps: [] },
});

const mergeTelnetTraceSnapshots = (
  ...snapshots: Array<TelnetTraceSnapshot | null | undefined>
): TelnetTraceSnapshot | null => {
  const valid = snapshots.filter(
    (snapshot): snapshot is TelnetTraceSnapshot => snapshot !== null && snapshot !== undefined,
  );
  if (valid.length === 0) return null;

  return {
    hostname: valid.find((snapshot) => snapshot.hostname)?.hostname ?? null,
    port: valid.find((snapshot) => typeof snapshot.port === "number")?.port ?? null,
    requestPayload: {
      steps: valid.flatMap((snapshot) => snapshot.requestPayload.steps.map((step) => ({ ...step }))),
    },
    responsePayload: {
      steps: valid.flatMap((snapshot) =>
        snapshot.responsePayload.steps.map((step) =>
          step.type === "screen"
            ? {
                ...step,
                menus: step.menus.map((menu) => ({
                  ...menu,
                  items: menu.items.map((item) => ({ ...item })),
                })),
              }
            : { ...step },
        ),
      ),
    },
  };
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
  const warnedCapabilityCacheMismatchRef = useRef<string | null>(null);
  const { status } = useC64Connection();
  const stableDeviceInfo = useMemo(
    () => (status.deviceInfo ? { ...status.deviceInfo } : null),
    [
      status.deviceInfo?.firmware_version,
      status.deviceInfo?.hostname,
      status.deviceInfo?.product,
      status.deviceInfo?.unique_id,
    ],
  );
  const capability = resolveTelnetCapability({
    isConnected: status.isConnected,
    isDemo: status.isDemo,
    product: stableDeviceInfo?.product,
  });
  const isAvailable = capability.isAvailable;
  const capabilityCacheKey = capability.menuKey
    ? buildTelnetCapabilityCacheKey(
        stableDeviceInfo,
        capability.menuKey,
        stripPortFromDeviceHost(resolveDeviceHostFromStorage()),
      )
    : null;

  const loadCapabilities = useCallback(async (): Promise<TelnetCapabilityLoadResult> => {
    if (
      !capability.isAvailable ||
      capability.menuKey === null ||
      capabilityCacheKey === null ||
      stableDeviceInfo == null
    ) {
      throw new TelnetError("Telnet is unavailable for the current device", "UNSUPPORTED_ACTION");
    }
    const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
    const port = getStoredTelnetPort();
    const cacheKey = capabilityCacheKey;
    const menuKey = capability.menuKey as NonNullable<typeof capability.menuKey>;
    const cachedSnapshot = getCachedTelnetCapabilities(cacheKey, stableDeviceInfo);
    if (cachedSnapshot) {
      return {
        snapshot: cachedSnapshot,
        trace: null,
      };
    }

    let discoveryTrace = buildEmptyTelnetTraceSnapshot(host, port);
    const traceAction = createActionContext("Telnet capability discovery", "system", LOG_TAG);
    const pauseHandle = pollingPauseRegistry.acquirePause();
    try {
      const snapshot = await withTelnetInteraction(
        {
          action: traceAction,
          actionId: "capability-discovery",
          intent: "system",
          host,
          port,
        },
        async () =>
          await discoverTelnetCapabilities({
            cacheKey,
            deviceInfo: stableDeviceInfo,
            menuKey,
            runner: {
              withSession: async (callback) => {
                const password = await getPassword();
                const transport = createTelnetClient();
                const session = createTelnetSession(transport);
                try {
                  await session.connect(host, port, password ?? undefined);
                  return await callback(session);
                } finally {
                  discoveryTrace =
                    mergeTelnetTraceSnapshots(discoveryTrace, session.getTraceSnapshot?.()) ?? discoveryTrace;
                  await session.disconnect();
                }
              },
            },
          }),
      );

      return {
        snapshot,
        trace: discoveryTrace,
      };
    } finally {
      pauseHandle.release();
    }
  }, [capability.isAvailable, capability.menuKey, capabilityCacheKey, stableDeviceInfo]);

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
      actionSupport[actionId as keyof typeof actionSupport] ?? {
        actionId: actionId as never,
        status: "unknown",
        reason: "Unknown Telnet action.",
        target: null,
      },
    [actionSupport],
  );

  useEffect(() => {
    if (
      !status.isConnected ||
      stableDeviceInfo == null ||
      !capability.isAvailable ||
      capability.menuKey === null ||
      capabilityCacheKey === null
    ) {
      setCapabilities(null);
      setDiscoveryError(null);
      setDiscoveryState("idle");
      warnedCapabilityCacheMismatchRef.current = null;
      return;
    }

    const cachedSnapshot = getCachedTelnetCapabilities(capabilityCacheKey, stableDeviceInfo);
    if (cachedSnapshot) {
      setCapabilities(cachedSnapshot);
      setDiscoveryError(null);
      setDiscoveryState("ready");
      return;
    }

    setCapabilities(null);
    setDiscoveryError(null);
    setDiscoveryState("idle");
  }, [capability.isAvailable, capability.menuKey, capabilityCacheKey, stableDeviceInfo, status.isConnected]);

  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      !capabilities ||
      capabilityCacheKey === null ||
      capabilities.cacheKey === capabilityCacheKey
    ) {
      warnedCapabilityCacheMismatchRef.current = null;
      return;
    }

    const warningKey = `${capabilities.cacheKey}=>${capabilityCacheKey}`;
    if (warnedCapabilityCacheMismatchRef.current === warningKey) {
      return;
    }
    warnedCapabilityCacheMismatchRef.current = warningKey;
    addLog("warn", `${LOG_TAG}: capability cache key changed after snapshot load`, {
      currentCacheKey: capabilityCacheKey,
      loadedCacheKey: capabilities.cacheKey,
    });
  }, [capabilities, capabilityCacheKey]);

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
      const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
      const port = getStoredTelnetPort();
      const traceAction = createActionContext(`Telnet ${action.label}`, "user", LOG_TAG);
      const fallbackTrace = buildEmptyTelnetTraceSnapshot(host, port);
      let discoveryTrace: TelnetTraceSnapshot | null = null;
      let executionTrace: TelnetTraceSnapshot | null = null;
      let resolvedMenuPath = action.menuPath;
      inflightRef.current = actionId;
      setActiveActionId(actionId);
      incrementTelnetInFlight();

      try {
        await runWithActionTrace(traceAction, async () => {
          const startedAt = Date.now();
          try {
            let capabilityLoad: TelnetCapabilityLoadResult;
            try {
              setDiscoveryState("loading");
              setDiscoveryError(null);
              capabilityLoad = await loadCapabilities();
              setCapabilities(capabilityLoad.snapshot);
              setDiscoveryState("ready");
            } catch (error) {
              const message = (error as Error).message;
              setCapabilities(null);
              setDiscoveryError(message);
              setDiscoveryState("error");
              addLog("error", `${LOG_TAG}: capability discovery failed`, {
                cacheKey: capabilityCacheKey,
                error: message,
              });
              throw error;
            }
            discoveryTrace = capabilityLoad.trace;
            const support =
              capabilityLoad.snapshot.actionSupport[actionId as keyof typeof capabilityLoad.snapshot.actionSupport];
            if (!support || support.status !== "supported" || !support.target) {
              throw new TelnetError(
                support?.reason ?? `Unable to resolve Telnet action ${actionId}`,
                support?.status === "unknown" ? "DISCOVERY_FAILED" : "UNSUPPORTED_ACTION",
                { actionId },
              );
            }
            resolvedMenuPath = [support.target.categoryLabel, support.target.actionLabel];

            await withTelnetInteraction(
              {
                action: traceAction,
                actionId,
                intent: "user",
                host,
                port,
              },
              async () => {
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
                  executionTrace = session.getTraceSnapshot?.() ?? fallbackTrace;
                  await session.disconnect();
                }
              },
            );

            const traceSnapshot = mergeTelnetTraceSnapshots(discoveryTrace, executionTrace) ?? fallbackTrace;
            recordTelnetOperation(traceAction, {
              actionId: action.id,
              actionLabel: action.label,
              menuPath: resolvedMenuPath,
              hostname: host,
              port,
              durationMs: Date.now() - startedAt,
              result: "success",
              error: null,
              requestPayload: traceSnapshot.requestPayload,
              responsePayload: traceSnapshot.responsePayload,
            });
          } catch (error) {
            const resolvedError = error as Error;
            const traceSnapshot = mergeTelnetTraceSnapshots(discoveryTrace, executionTrace) ?? fallbackTrace;
            recordTelnetOperation(traceAction, {
              actionId: action.id,
              actionLabel: action.label,
              menuPath: resolvedMenuPath,
              hostname: host,
              port,
              durationMs: Date.now() - startedAt,
              result: "failure",
              error: resolvedError,
              requestPayload: traceSnapshot.requestPayload,
              responsePayload: traceSnapshot.responsePayload,
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
    [capability.isAvailable, capability.menuKey, capabilityCacheKey, loadCapabilities],
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
