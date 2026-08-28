/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const connectionState = vi.hoisted(() => ({ state: "DISCONNECTED" as string, routingEpoch: 0 }));
vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ state: connectionState.state }),
}));
vi.mock("@/hooks/useC64Connection", () => ({
  useConnectionRoutingEpoch: () => connectionState.routingEpoch,
}));

const getConfigItem = vi.hoisted(() => vi.fn());
vi.mock("@/lib/c64api", () => ({ getC64API: () => ({ getConfigItem }) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { useDeviceColorScheme } from "@/hooks/useDeviceColorScheme";

describe("useDeviceColorScheme", () => {
  beforeEach(() => {
    connectionState.state = "DISCONNECTED";
    connectionState.routingEpoch = 0;
    getConfigItem.mockReset();
  });

  it("starts at null before any connection", () => {
    const { result } = renderHook(() => useDeviceColorScheme());
    expect(result.current.colorScheme).toBeNull();
    expect(getConfigItem).not.toHaveBeenCalled();
  });

  it("reads once when the connection reaches REAL_CONNECTED (spec.md section 7.4)", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "Ultimate Black" } },
    });
    const { result, rerender } = renderHook(() => useDeviceColorScheme());

    connectionState.state = "REAL_CONNECTED";
    rerender();

    await vi.waitFor(() => expect(result.current.colorScheme).toBe("Ultimate Black"));
    expect(getConfigItem).toHaveBeenCalledTimes(1);
    expect(getConfigItem).toHaveBeenCalledWith("User Interface Settings", "Color Scheme", {
      __c64uIntent: "background",
    });
  });

  it("does not read in demo mode, which has no device Color Scheme to match", async () => {
    connectionState.state = "DEMO_ACTIVE";
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    rerender();
    expect(getConfigItem).not.toHaveBeenCalled();
    expect(result.current.colorScheme).toBeNull();
  });

  it("does not re-read on a re-render that changes nothing (never polls)", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "C128 Style" } },
    });
    connectionState.state = "REAL_CONNECTED";
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    await vi.waitFor(() => expect(result.current.colorScheme).toBe("C128 Style"));

    rerender();
    rerender();
    rerender();
    expect(getConfigItem).toHaveBeenCalledTimes(1);
  });

  /*
   * The defect this guards, found on a real Pixel 4 against a real Ultimate: connecting calls
   * applyC64APIRuntimeConfig straight after transitionTo("REAL_CONNECTED"), which bumps the request
   * generation and aborts every read started on that edge. Keyed on the connect edge alone, this
   * hook's read was aborted on every launch and never retried, so "Match my device" stayed on the
   * compiled default until the user happened to press Refresh connection.
   */
  it("re-reads when the routing epoch changes, so a read aborted by the connection handoff recovers", async () => {
    getConfigItem.mockRejectedValueOnce(new Error("Request superseded by routing change"));
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "Ultimate Black" } },
    });

    connectionState.state = "REAL_CONNECTED";
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    await vi.waitFor(() => expect(getConfigItem).toHaveBeenCalledTimes(1));
    expect(result.current.colorScheme).toBeNull();

    connectionState.routingEpoch = 1;
    rerender();

    await vi.waitFor(() => expect(result.current.colorScheme).toBe("Ultimate Black"));
    expect(getConfigItem).toHaveBeenCalledTimes(2);
  });

  it("clears the cached value on disconnect", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "Commodore Blue" } },
    });
    connectionState.state = "REAL_CONNECTED";
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    await vi.waitFor(() => expect(result.current.colorScheme).toBe("Commodore Blue"));

    connectionState.state = "DISCONNECTED";
    rerender();
    expect(result.current.colorScheme).toBeNull();
  });

  it("re-reads on the next connect after a disconnect", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "Commodore 1" } },
    });
    connectionState.state = "REAL_CONNECTED";
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    await vi.waitFor(() => expect(result.current.colorScheme).toBe("Commodore 1"));

    connectionState.state = "DISCONNECTED";
    rerender();
    connectionState.state = "REAL_CONNECTED";
    rerender();

    await vi.waitFor(() => expect(getConfigItem).toHaveBeenCalledTimes(2));
  });

  it("stays null when the config item is absent or the read fails", async () => {
    getConfigItem.mockRejectedValue(new Error("404"));
    connectionState.state = "REAL_CONNECTED";
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    rerender();
    await vi.waitFor(() => expect(getConfigItem).toHaveBeenCalled());
    expect(result.current.colorScheme).toBeNull();
  });

  it("exposes a manual refresh function for the Settings 'Refresh connection' action to call", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "C128 Style" } },
    });
    const { result } = renderHook(() => useDeviceColorScheme());
    expect(result.current.colorScheme).toBeNull();

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.colorScheme).toBe("C128 Style");
  });
});
