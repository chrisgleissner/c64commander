/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const statusState: { isConnected: boolean; deviceInfo: { core_version?: string; firmware_version?: string } | null } = {
  isConnected: false,
  deviceInfo: null,
};

const probeMachineInputCapabilityMock = vi.fn();
const addErrorLogMock = vi.fn();

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: statusState }),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({}),
}));

vi.mock("@/lib/deviceCapabilities", () => ({
  probeMachineInputCapability: (...args: unknown[]) => probeMachineInputCapabilityMock(...args),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  getSelectedSavedDevice: () => ({ id: "device-a" }),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
  buildErrorLogDetails: (error: Error, context: Record<string, unknown>) => ({ error: error.message, ...context }),
}));

import { useRemoteInputCapabilityTier } from "@/hooks/useRemoteInputCapabilityTier";

describe("useRemoteInputCapabilityTier", () => {
  beforeEach(() => {
    statusState.isConnected = false;
    statusState.deviceInfo = null;
    probeMachineInputCapabilityMock.mockReset();
    addErrorLogMock.mockClear();
  });

  it("defaults to the conservative kernal-fallback tier when not connected, without probing", () => {
    const { result } = renderHook(() => useRemoteInputCapabilityTier());
    expect(result.current).toEqual({ tier: "kernal-fallback", loading: false, resolved: false });
    expect(probeMachineInputCapabilityMock).not.toHaveBeenCalled();
  });

  it("resolves to the full tier once a connected device's probe reports available", async () => {
    statusState.isConnected = true;
    statusState.deviceInfo = { core_version: "1.4B", firmware_version: "3.15" };
    probeMachineInputCapabilityMock.mockResolvedValue({ status: "available" });

    const { result } = renderHook(() => useRemoteInputCapabilityTier());

    await waitFor(() => expect(result.current).toEqual({ tier: "full", loading: false, resolved: true }));
    expect(probeMachineInputCapabilityMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "device-a", firmwareVersion: "3.15", coreVersion: "1.4B" }),
    );
  });

  it("resolves to the kernal-fallback tier when the probe reports the route is missing", async () => {
    statusState.isConnected = true;
    statusState.deviceInfo = { core_version: null as unknown as string, firmware_version: "1.1.0" };
    probeMachineInputCapabilityMock.mockResolvedValue({ status: "missing" });

    const { result } = renderHook(() => useRemoteInputCapabilityTier());

    await waitFor(() => expect(result.current).toEqual({ tier: "kernal-fallback", loading: false, resolved: true }));
  });

  it("falls back to kernal-fallback and logs when the probe itself rejects", async () => {
    statusState.isConnected = true;
    statusState.deviceInfo = { core_version: "1.4B" };
    probeMachineInputCapabilityMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useRemoteInputCapabilityTier());

    await waitFor(() => expect(result.current).toEqual({ tier: "kernal-fallback", loading: false, resolved: false }));
    expect(addErrorLogMock).toHaveBeenCalledWith("Remote input capability probe failed", expect.any(Object));
  });

  it("does not probe while disabled, even when connected (kept out of the hot path)", () => {
    statusState.isConnected = true;
    statusState.deviceInfo = { core_version: "1.4B" };

    const { result } = renderHook(() => useRemoteInputCapabilityTier(false));

    expect(result.current).toEqual({ tier: "kernal-fallback", loading: false, resolved: false });
    expect(probeMachineInputCapabilityMock).not.toHaveBeenCalled();
  });

  it("resets to the conservative, unresolved tier when the connection drops", async () => {
    statusState.isConnected = true;
    statusState.deviceInfo = { core_version: "1.4B" };
    probeMachineInputCapabilityMock.mockResolvedValue({ status: "available" });

    const { result, rerender } = renderHook(() => useRemoteInputCapabilityTier());
    await waitFor(() => expect(result.current.tier).toBe("full"));

    statusState.isConnected = false;
    rerender();

    expect(result.current).toEqual({ tier: "kernal-fallback", loading: false, resolved: false });
  });

  // HARD15-006: `resolved` must distinguish a genuine probe answer from the
  // shared default/reset shape - an error/auth-required outcome uses the same
  // tier value as "not yet probed" but must NOT be treated as resolved, so a
  // consumer (the sheet's smart-default effect) does not act on it as if the
  // device had genuinely been found unsupported.
  it.each([
    ["error", "kernal-fallback"],
    ["auth-required", "auth-required"],
  ] as const)(
    "marks the tier unresolved (though still updated) for a non-definitive '%s' probe status",
    async (status, expectedTier) => {
      statusState.isConnected = true;
      statusState.deviceInfo = { core_version: "1.4B" };
      probeMachineInputCapabilityMock.mockResolvedValue({ status });

      const { result } = renderHook(() => useRemoteInputCapabilityTier());

      await waitFor(() => expect(result.current).toEqual({ tier: expectedTier, loading: false, resolved: false }));
    },
  );
});
