/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTelnetAvailable, useTelnetActions } from "@/hooks/useTelnetActions";
import { TELNET_ACTION_IDS, type TelnetActionId } from "@/lib/telnet/telnetTypes";

const {
  getPlatformMock,
  isNativePlatformMock,
  shouldUseMockTelnetTransportMock,
  statusRef,
  recordTelnetOperationSpy,
  incrementTelnetInFlightSpy,
  decrementTelnetInFlightSpy,
  runWithActionTraceSpy,
  discoverTelnetCapabilitiesSpy,
  createActionExecutorSpy,
} = vi.hoisted(() => ({
  getPlatformMock: vi.fn(() => "android"),
  isNativePlatformMock: vi.fn(() => true),
  shouldUseMockTelnetTransportMock: vi.fn(() => false),
  statusRef: {
    current: {
      isConnected: true,
      isDemo: false,
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-1",
      },
    },
  },
  recordTelnetOperationSpy: vi.fn(),
  incrementTelnetInFlightSpy: vi.fn(),
  decrementTelnetInFlightSpy: vi.fn(),
  runWithActionTraceSpy: vi.fn(async (_action: unknown, handler: () => Promise<void>) => await handler()),
  discoverTelnetCapabilitiesSpy: vi.fn(),
  createActionExecutorSpy: vi.fn(),
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => getPlatformMock(),
  isNativePlatform: () => isNativePlatformMock(),
}));

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/telnet/telnetClient", () => ({
  createTelnetClient: () => ({}),
  shouldUseMockTelnetTransport: () => shouldUseMockTelnetTransportMock(),
}));

vi.mock("@/lib/telnet/telnetSession", () => ({
  createTelnetSession: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
  }),
}));

vi.mock("@/lib/telnet/telnetActionExecutor", () => ({
  createActionExecutor: (...args: unknown[]) => {
    createActionExecutorSpy(...args);
    return {
      execute: mockExecute,
    };
  },
}));

vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  withTelnetInteraction: (_meta: unknown, handler: () => Promise<void>) => handler(),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: statusRef.current,
  }),
}));

vi.mock("@/lib/c64api", () => ({
  resolveDeviceHostFromStorage: () => "u64",
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: () => Promise.resolve(null),
}));

vi.mock("@/lib/tracing/traceIds", () => ({
  nextCorrelationId: () => "test-correlation-id",
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  createActionContext: vi.fn((name: string) => ({ id: `action:${name}`, name })),
  runWithActionTrace: runWithActionTraceSpy,
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordTelnetOperation: recordTelnetOperationSpy,
}));

vi.mock("@/lib/diagnostics/diagnosticsActivity", () => ({
  incrementTelnetInFlight: incrementTelnetInFlightSpy,
  decrementTelnetInFlight: decrementTelnetInFlightSpy,
}));

vi.mock("@/lib/telnet/telnetCapabilityDiscovery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/telnet/telnetCapabilityDiscovery")>(
    "@/lib/telnet/telnetCapabilityDiscovery",
  );
  return {
    ...actual,
    discoverTelnetCapabilities: (...args: unknown[]) => discoverTelnetCapabilitiesSpy(...args),
  };
});

const buildActionSupport = (
  overrides: Partial<
    Record<TelnetActionId, { status: "supported" | "unsupported" | "unknown"; reason?: string | null }>
  >,
) =>
  Object.fromEntries(
    TELNET_ACTION_IDS.map((actionId) => {
      const override = overrides[actionId];
      return [
        actionId,
        {
          actionId,
          status: override?.status ?? "supported",
          reason: override?.reason ?? null,
          target:
            override?.status === "unsupported" || override?.status === "unknown"
              ? null
              : {
                categoryLabel: actionId === "powerCycle" ? "Power & Reset" : "Configuration",
                actionLabel:
                  actionId === "powerCycle"
                    ? "Power Cycle"
                    : actionId === "saveConfigToFile"
                      ? "Save to File"
                      : "Reset",
                source: "initial" as const,
              },
        },
      ];
    }),
  );

const buildSnapshot = (
  overrides: Partial<
    Record<TelnetActionId, { status: "supported" | "unsupported" | "unknown"; reason?: string | null }>
  > = {},
) => ({
  cacheKey: "u64|F5",
  deviceIdentity: "u64-1|u64|Ultimate 64 Elite|3.14e",
  menuKey: "F5" as const,
  initialMenu: {
    items: ["C64 Machine", "Configuration"],
    defaultItem: "C64 Machine",
    nodes: {
      "C64 Machine": {
        kind: "submenu" as const,
        items: ["Reset C64", "Reboot C64", "Reboot (Clr Mem)"],
        defaultItem: "Reset C64",
      },
      Configuration: {
        kind: "submenu" as const,
        items: ["Save to File", "Clear Flash Config"],
        defaultItem: "Save to File",
      },
    },
  },
  actionSupport: buildActionSupport(overrides),
});

describe("isTelnetAvailable", () => {
  it("returns false when not on native platform", () => {
    expect(isTelnetAvailable({ nativePlatform: false, isConnected: true, isDemo: false, product: "Ultimate 64" })).toBe(
      false,
    );
  });

  it("returns true for supported connected native devices", () => {
    expect(isTelnetAvailable({ nativePlatform: true, isConnected: true, isDemo: false, product: "Ultimate 64" })).toBe(
      true,
    );
  });

  it("returns false for unsupported products even on native", () => {
    expect(
      isTelnetAvailable({ nativePlatform: true, isConnected: true, isDemo: false, product: "1541 Ultimate II+" }),
    ).toBe(false);
  });

  it("returns true for demo mode when backed by a mock telnet target", () => {
    expect(
      isTelnetAvailable({
        nativePlatform: false,
        isConnected: true,
        isDemo: true,
        product: "Ultimate 64",
        mockTarget: true,
      }),
    ).toBe(true);
  });

  it("returns false for demo mode without a mock telnet target", () => {
    expect(
      isTelnetAvailable({
        nativePlatform: true,
        isConnected: true,
        isDemo: true,
        product: "Ultimate 64",
        mockTarget: false,
      }),
    ).toBe(false);
  });
});

describe("useTelnetActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlatformMock.mockReturnValue("android");
    isNativePlatformMock.mockReturnValue(true);
    shouldUseMockTelnetTransportMock.mockReturnValue(false);
    statusRef.current = {
      isConnected: true,
      isDemo: false,
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-1",
      },
    };
    mockExecute.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    discoverTelnetCapabilitiesSpy.mockResolvedValue(buildSnapshot());
  });

  it("returns initial availability and loads discovery state", async () => {
    const { result } = renderHook(() => useTelnetActions());

    expect(result.current.isBusy).toBe(false);
    expect(result.current.activeActionId).toBeNull();
    expect(result.current.isAvailable).toBe(true);

    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));
    expect(discoverTelnetCapabilitiesSpy).toHaveBeenCalledTimes(1);
  });

  it("exposes unsupported action state from discovery", async () => {
    discoverTelnetCapabilitiesSpy.mockResolvedValue(
      buildSnapshot({
        powerCycle: {
          status: "unsupported",
          reason: "Power Cycle is not available on Ultimate 64 Elite 3.14e.",
        },
      }),
    );

    const { result } = renderHook(() => useTelnetActions());

    await waitFor(() => {
      expect(result.current.getActionSupport("powerCycle")).toMatchObject({
        status: "unsupported",
        reason: "Power Cycle is not available on Ultimate 64 Elite 3.14e.",
      });
    });
  });

  it("uses the discovery runner session to connect and disconnect around capability probing", async () => {
    discoverTelnetCapabilitiesSpy.mockImplementationOnce(async ({ runner }: { runner: { withSession: Function } }) =>
      await runner.withSession(async () => buildSnapshot()),
    );

    const { result } = renderHook(() => useTelnetActions());

    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));
    expect(mockConnect).toHaveBeenCalledWith("u64", 23, undefined);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("returns disconnected fallback support without starting discovery", () => {
    statusRef.current = {
      ...statusRef.current,
      isConnected: false,
    };

    const { result } = renderHook(() => useTelnetActions());

    expect(result.current.discoveryState).toBe("idle");
    expect(result.current.getActionSupport("powerCycle")).toMatchObject({
      status: "unsupported",
      reason: "Connect to a C64 Ultimate device to inspect Telnet actions.",
    });
    expect(discoverTelnetCapabilitiesSpy).not.toHaveBeenCalled();
  });

  it("returns unavailable fallback support when telnet cannot run on the platform", () => {
    isNativePlatformMock.mockReturnValue(false);

    const { result } = renderHook(() => useTelnetActions());

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.getActionSupport("powerCycle")).toMatchObject({
      status: "unsupported",
      reason: "Telnet actions are unavailable on this platform or device.",
    });
  });

  it("surfaces capability discovery failures through state and fallback support", async () => {
    const { addLog } = await import("@/lib/logging");
    discoverTelnetCapabilitiesSpy.mockRejectedValueOnce(new Error("capability lookup exploded"));

    const { result } = renderHook(() => useTelnetActions());

    await waitFor(() => expect(result.current.discoveryState).toBe("error"));
    expect(result.current.discoveryError).toBe("capability lookup exploded");
    expect(result.current.getActionSupport("powerCycle")).toMatchObject({
      status: "unknown",
      reason: "Telnet action discovery failed: capability lookup exploded",
    });
    expect(addLog).toHaveBeenCalledWith("error", 'useTelnetActions: capability discovery failed', {
      cacheKey: 'u64-1|u64|Ultimate 64 Elite|3.14e|F5',
      error: 'capability lookup exploded',
    });
  });

  it("returns a default unknown support object for unrecognized action ids", async () => {
    const { result } = renderHook(() => useTelnetActions());

    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));
    expect(result.current.getActionSupport("ghostAction")).toEqual({
      actionId: "ghostAction",
      status: "unknown",
      reason: "Unknown Telnet action.",
      target: null,
    });
  });

  it("executes a known telnet action through the discovered target", async () => {
    const { result } = renderHook(() => useTelnetActions());

    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));

    await act(async () => {
      await result.current.executeAction("powerCycle");
    });

    expect(mockConnect).toHaveBeenCalledWith("u64", 23, undefined);
    expect(createActionExecutorSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        menuKey: "F5",
        resolvedTargets: {
          powerCycle: {
            categoryLabel: "Power & Reset",
            actionLabel: "Power Cycle",
            source: "initial",
          },
        },
      }),
    );
    expect(mockExecute).toHaveBeenCalledWith("powerCycle");
    expect(recordTelnetOperationSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        actionId: "powerCycle",
        actionLabel: "Power Cycle",
        menuPath: ["Power & Reset", "Power Cycle"],
        result: "success",
      }),
    );
    expect(incrementTelnetInFlightSpy).toHaveBeenCalledTimes(1);
    expect(decrementTelnetInFlightSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when discovery resolves the action as unsupported", async () => {
    discoverTelnetCapabilitiesSpy.mockResolvedValue(
      buildSnapshot({
        powerCycle: {
          status: "unsupported",
          reason: "Power Cycle is not available on Ultimate 64 Elite 3.14e.",
        },
      }),
    );

    const { result } = renderHook(() => useTelnetActions());
    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));

    await expect(
      act(async () => {
        await result.current.executeAction("powerCycle");
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_ACTION",
      message: "Power Cycle is not available on Ultimate 64 Elite 3.14e.",
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("throws for unknown telnet action ids", async () => {
    const { result } = renderHook(() => useTelnetActions());

    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));
    await expect(result.current.executeAction("ghostAction")).rejects.toThrow("Unknown Telnet action: ghostAction");
  });

  it("throws when telnet is unavailable for the current device", async () => {
    statusRef.current = {
      ...statusRef.current,
      isConnected: false,
    };

    const { result } = renderHook(() => useTelnetActions());

    await expect(result.current.executeAction("powerCycle")).rejects.toThrow(
      "Telnet is unavailable for the current device",
    );
  });

  it("maps unknown discovery support to a discovery failure error", async () => {
    discoverTelnetCapabilitiesSpy.mockResolvedValue(
      buildSnapshot({
        powerCycle: {
          status: "unknown",
          reason: "Discovery still in progress.",
        },
      }),
    );

    const { result } = renderHook(() => useTelnetActions());
    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));

    await expect(result.current.executeAction("powerCycle")).rejects.toMatchObject({
      code: "DISCOVERY_FAILED",
      message: "Discovery still in progress.",
    });
  });

  it("records execution failures and resets busy state", async () => {
    const { addLog } = await import("@/lib/logging");
    mockExecute.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useTelnetActions());
    await waitFor(() => expect(result.current.discoveryState).toBe("ready"));

    await expect(result.current.executeAction("powerCycle")).rejects.toThrow("boom");
    expect(recordTelnetOperationSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        actionId: "powerCycle",
        result: "failure",
        error: expect.objectContaining({ message: "boom" }),
      }),
    );
    expect(addLog).toHaveBeenCalledWith('error', 'useTelnetActions: action "powerCycle" failed', {
      error: 'boom',
    });
    expect(decrementTelnetInFlightSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isBusy).toBe(false);
    expect(result.current.activeActionId).toBeNull();
  });
});
