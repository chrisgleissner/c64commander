/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTelnetAvailable, useTelnetActions } from "@/hooks/useTelnetActions";

const {
  getPlatformMock,
  isNativePlatformMock,
  shouldUseMockTelnetTransportMock,
  statusRef,
  recordTelnetOperationSpy,
  incrementTelnetInFlightSpy,
  decrementTelnetInFlightSpy,
  runWithActionTraceSpy,
} = vi.hoisted(() => ({
  getPlatformMock: vi.fn(() => "android"),
  isNativePlatformMock: vi.fn(() => false),
  shouldUseMockTelnetTransportMock: vi.fn(() => false),
  statusRef: {
    current: {
      isConnected: true,
      isDemo: false,
      deviceInfo: { product: "Ultimate 64 Elite" },
    },
  },
  recordTelnetOperationSpy: vi.fn(),
  incrementTelnetInFlightSpy: vi.fn(),
  decrementTelnetInFlightSpy: vi.fn(),
  runWithActionTraceSpy: vi.fn(async (_action: unknown, handler: () => Promise<void>) => await handler()),
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
  createActionExecutor: () => ({
    execute: mockExecute,
  }),
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
  resolveDeviceHostFromStorage: () => "c64u",
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

  it("returns true for iOS native devices when connected to a supported product", () => {
    expect(
      isTelnetAvailable({
        nativePlatform: true,
        isConnected: true,
        isDemo: false,
        product: "Ultimate 64",
      }),
    ).toBe(true);
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

  it("returns true for external mock targets on web when telnet is mock-backed", () => {
    expect(
      isTelnetAvailable({
        nativePlatform: false,
        isConnected: true,
        isDemo: false,
        product: "Ultimate 64",
        mockTarget: true,
      }),
    ).toBe(true);
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
      deviceInfo: { product: "Ultimate 64 Elite" },
    };
    mockExecute.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
  });

  it("returns initial state", () => {
    const { result } = renderHook(() => useTelnetActions());
    expect(result.current.isBusy).toBe(false);
    expect(result.current.activeActionId).toBeNull();
    expect(result.current.isAvailable).toBe(true);
  });

  it("returns isAvailable=false on web", () => {
    isNativePlatformMock.mockReturnValue(false);
    const { result } = renderHook(() => useTelnetActions());
    expect(result.current.isAvailable).toBe(false);
  });

  it("returns isAvailable=true on iOS native builds", () => {
    getPlatformMock.mockReturnValue("ios");
    const { result } = renderHook(() => useTelnetActions());
    expect(result.current.isAvailable).toBe(true);
  });

  it("returns isAvailable=true for demo mode when the target is mock-backed", () => {
    isNativePlatformMock.mockReturnValue(false);
    shouldUseMockTelnetTransportMock.mockReturnValue(true);
    statusRef.current = {
      isConnected: true,
      isDemo: true,
      deviceInfo: { product: "Ultimate 64 Elite" },
    };

    const { result } = renderHook(() => useTelnetActions());

    expect(result.current.isAvailable).toBe(true);
  });

  it("returns isAvailable=false when the connected product is not Telnet-capable", () => {
    statusRef.current = {
      isConnected: true,
      isDemo: false,
      deviceInfo: { product: "1541 Ultimate II+" },
    };
    const { result } = renderHook(() => useTelnetActions());
    expect(result.current.isAvailable).toBe(false);
  });

  it("executes a known telnet action successfully", async () => {
    const { result } = renderHook(() => useTelnetActions());

    await act(async () => {
      await result.current.executeAction("powerCycle");
    });

    expect(mockConnect).toHaveBeenCalledWith("c64u", 23, undefined);
    expect(mockExecute).toHaveBeenCalledWith("powerCycle");
    expect(mockDisconnect).toHaveBeenCalled();
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
    expect(result.current.isBusy).toBe(false);
    expect(result.current.activeActionId).toBeNull();
  });

  it("throws for unknown action", async () => {
    const { result } = renderHook(() => useTelnetActions());

    await expect(
      act(async () => {
        await result.current.executeAction("nonexistent");
      }),
    ).rejects.toThrow("Unknown Telnet action: nonexistent");
  });

  it("disconnects even when execute throws", async () => {
    mockExecute.mockRejectedValueOnce(new Error("action failed"));
    const { result } = renderHook(() => useTelnetActions());

    let caught: Error | undefined;
    await act(async () => {
      try {
        await result.current.executeAction("powerCycle");
      } catch (e) {
        caught = e as Error;
      }
    });

    expect(caught?.message).toBe("action failed");
    expect(mockDisconnect).toHaveBeenCalled();
    expect(recordTelnetOperationSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        actionId: "powerCycle",
        result: "failure",
        error: expect.any(Error),
      }),
    );
    expect(result.current.isBusy).toBe(false);
  });

  it("prevents double execution via inflight guard", async () => {
    let resolveFirst: () => void;
    mockExecute.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)));

    const { result } = renderHook(() => useTelnetActions());

    // Start first action (won't complete immediately)
    let firstPromise: Promise<void>;
    await act(async () => {
      firstPromise = result.current.executeAction("powerCycle");
    });

    // Try second action while first is in-flight — should be ignored
    await act(async () => {
      await result.current.executeAction("iecReset");
    });

    // Only one execute call should have been made
    expect(mockExecute).toHaveBeenCalledTimes(1);

    // Now resolve the first
    await act(async () => {
      resolveFirst!();
      await firstPromise!;
    });
  });
});
