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

const { isNativePlatformMock } = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
}));

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/telnet/telnetClient", () => ({
  createTelnetClient: () => ({}),
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

describe("isTelnetAvailable", () => {
  it("returns false when not on native platform", () => {
    isNativePlatformMock.mockReturnValue(false);
    expect(isTelnetAvailable()).toBe(false);
  });

  it("returns true when on native platform", () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(isTelnetAvailable()).toBe(true);
  });
});

describe("useTelnetActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatformMock.mockReturnValue(true);
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

  it("executes a known telnet action successfully", async () => {
    const { result } = renderHook(() => useTelnetActions());

    await act(async () => {
      await result.current.executeAction("powerCycle");
    });

    expect(mockConnect).toHaveBeenCalledWith("c64u", 23, undefined);
    expect(mockExecute).toHaveBeenCalledWith("powerCycle");
    expect(mockDisconnect).toHaveBeenCalled();
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
