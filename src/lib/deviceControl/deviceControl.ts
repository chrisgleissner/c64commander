/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { getC64API, type C64API } from "@/lib/c64api";
import { clearRamAndReboot } from "@/lib/machine/ramOperations";
import { addErrorLog, buildErrorLogDetails } from "@/lib/logging";
import { createActionContext, runWithActionTrace } from "@/lib/tracing/actionTrace";
import { recordDeviceGuard } from "@/lib/tracing/traceSession";

export type DeviceControlOperation = "toggleMenu" | "rebootKeepRam" | "rebootFull" | "powerCycle";

export type DeviceControlTransport = "REST" | "REST_FALLBACK_FULL_REBOOT";

export type DeviceControlResult = {
  operation: DeviceControlOperation;
  transport: DeviceControlTransport;
  endpoint: string | string[];
  response: unknown;
  menuOpen: boolean;
};

type DeviceControlDependencies = {
  api: C64API;
  clearRamAndRebootImpl?: typeof clearRamAndReboot;
  initialMenuOpen?: boolean;
};

type EndpointDescriptor = string | string[];

type RunControlOperationOptions<T> = {
  operation: DeviceControlOperation;
  transport: DeviceControlTransport;
  endpoint: EndpointDescriptor;
  request: Record<string, unknown>;
  execute: () => Promise<T>;
  normalizeResponse?: (response: T) => unknown;
};

const DEVICE_CONTROL_COMPONENT = "deviceControl";
const POWER_CYCLE_FALLBACK_ENDPOINTS = [
  "PUT /v1/machine:pause",
  "PUT /v1/machine:writemem",
  "PUT /v1/machine:reboot",
] as const;

const formatEndpoint = (endpoint: EndpointDescriptor) => (Array.isArray(endpoint) ? endpoint.join(" -> ") : endpoint);

const assertRestActionSucceeded = (operation: DeviceControlOperation, response: { errors?: string[] } | undefined) => {
  const errors = Array.isArray(response?.errors) ? response.errors.filter((entry) => entry.trim().length > 0) : [];
  if (errors.length > 0) {
    throw new Error(`${operation} failed: ${errors.join("; ")}`);
  }
};

export class DeviceControlError extends Error {
  readonly operation: DeviceControlOperation;
  readonly transport: DeviceControlTransport;
  readonly endpoint: string | string[];
  readonly request: Record<string, unknown>;
  readonly response: unknown;

  constructor({
    message,
    operation,
    transport,
    endpoint,
    request,
    response,
    cause,
  }: {
    message: string;
    operation: DeviceControlOperation;
    transport: DeviceControlTransport;
    endpoint: string | string[];
    request: Record<string, unknown>;
    response: unknown;
    cause?: Error;
  }) {
    super(message);
    this.name = "DeviceControlError";
    this.operation = operation;
    this.transport = transport;
    this.endpoint = endpoint;
    this.request = request;
    this.response = response;
    if (cause) {
      this.cause = cause;
    }
  }
}

const asError = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : fallback);
};

export const isDeviceControlError = (error: unknown): error is DeviceControlError =>
  error instanceof DeviceControlError;

export const createDeviceControl = ({
  api,
  clearRamAndRebootImpl = clearRamAndReboot,
  initialMenuOpen = false,
}: DeviceControlDependencies) => {
  let menuOpen = initialMenuOpen;
  let menuToggleQueue = Promise.resolve<void>(undefined);

  const runControlOperation = async <T>({
    operation,
    transport,
    endpoint,
    request,
    execute,
    normalizeResponse,
  }: RunControlOperationOptions<T>): Promise<DeviceControlResult> => {
    const action = createActionContext(`deviceControl.${operation}`, "user", DEVICE_CONTROL_COMPONENT);

    return runWithActionTrace(action, async () => {
      recordDeviceGuard(action, {
        phase: "action_start",
        operation,
      });
      recordDeviceGuard(action, {
        phase: "transport_used",
        operation,
        transport,
        endpoint,
      });
      recordDeviceGuard(action, {
        phase: "request_payload",
        operation,
        transport,
        endpoint,
        request,
      });

      try {
        const rawResponse = await execute();
        const response = normalizeResponse ? normalizeResponse(rawResponse) : rawResponse;
        recordDeviceGuard(action, {
          phase: "response_payload",
          operation,
          transport,
          endpoint,
          response,
        });
        recordDeviceGuard(action, {
          phase: "action_result",
          operation,
          transport,
          endpoint,
          status: "success",
          menuOpen,
        });

        return {
          operation,
          transport,
          endpoint,
          response,
          menuOpen,
        } satisfies DeviceControlResult;
      } catch (error) {
        const cause = asError(error, `${operation} failed`);
        const response = {
          error: cause.message,
        };
        const structuredError = new DeviceControlError({
          message: cause.message,
          operation,
          transport,
          endpoint,
          request,
          response,
          cause,
        });

        addErrorLog(
          `Device control failed: ${operation}`,
          buildErrorLogDetails(structuredError, {
            operation,
            transport,
            endpoint,
            request,
            response,
          }),
        );

        recordDeviceGuard(action, {
          phase: "response_payload",
          operation,
          transport,
          endpoint,
          response,
        });
        recordDeviceGuard(action, {
          phase: "action_result",
          operation,
          transport,
          endpoint,
          status: "error",
          error: cause.message,
          menuOpen,
        });

        throw structuredError;
      }
    });
  };

  const toggleMenu = async () => {
    const executeToggle = () => {
      const desiredMenuState = menuOpen ? "closed" : "open";
      return runControlOperation({
        operation: "toggleMenu",
        transport: "REST",
        endpoint: "PUT /v1/machine:menu_button",
        request: {
          endpoint: "/v1/machine:menu_button",
          method: "PUT",
          currentMenuState: menuOpen ? "open" : "closed",
          desiredMenuState,
        },
        execute: async () => {
          const response = await api.machineMenuButton();
          assertRestActionSucceeded("toggleMenu", response);
          menuOpen = !menuOpen;
          return response;
        },
      });
    };

    const pending = menuToggleQueue.then(executeToggle, executeToggle);
    menuToggleQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  const rebootKeepRam = async () => {
    const result = await runControlOperation({
      operation: "rebootKeepRam",
      transport: "REST",
      endpoint: "PUT /v1/machine:reboot",
      request: {
        endpoint: "/v1/machine:reboot",
        method: "PUT",
        preserveRam: true,
      },
      execute: async () => {
        const response = await api.machineReboot();
        assertRestActionSucceeded("rebootKeepRam", response);
        menuOpen = false;
        return response;
      },
    });
    return result;
  };

  const rebootFull = async () => {
    const result = await runControlOperation({
      operation: "rebootFull",
      transport: "REST",
      endpoint: [...POWER_CYCLE_FALLBACK_ENDPOINTS],
      request: {
        strategy: "clear_ram_then_reboot",
        preserveRam: false,
        verifyRamClearBeforeReboot: true,
      },
      execute: async () => {
        await clearRamAndRebootImpl(api);
        menuOpen = false;
        return { errors: [] };
      },
    });
    return result;
  };

  const powerCycle = async () => {
    const result = await runControlOperation({
      operation: "powerCycle",
      transport: "REST_FALLBACK_FULL_REBOOT",
      endpoint: [...POWER_CYCLE_FALLBACK_ENDPOINTS],
      request: {
        strategy: "fallback_full_reboot",
        reason: "no_rest_power_cycle_endpoint",
        verifyRamClearBeforeReboot: true,
      },
      execute: async () => {
        await clearRamAndRebootImpl(api);
        menuOpen = false;
        return { errors: [], fallback: true };
      },
    });
    return result;
  };

  const resetMenuState = () => {
    menuOpen = false;
  };

  const getMenuState = () => menuOpen;

  return {
    toggleMenu,
    rebootKeepRam,
    rebootFull,
    powerCycle,
    resetMenuState,
    getMenuState,
    describePowerCycleFallback: () => formatEndpoint(POWER_CYCLE_FALLBACK_ENDPOINTS as unknown as EndpointDescriptor),
  };
};

export type DeviceControl = ReturnType<typeof createDeviceControl>;

export const useDeviceControl = ({ connected = true }: { connected?: boolean } = {}) => {
  const controlRef = useRef<DeviceControl | null>(null);

  if (controlRef.current === null) {
    controlRef.current = createDeviceControl({ api: getC64API() });
  }

  useEffect(() => {
    if (!connected) {
      controlRef.current?.resetMenuState();
    }
  }, [connected]);

  return controlRef.current;
};
