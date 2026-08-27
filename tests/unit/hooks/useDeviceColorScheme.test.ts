/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const connectionState = vi.hoisted(() => ({ isConnected: false }));
vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: { isConnected: connectionState.isConnected } }),
}));

const getConfigItem = vi.hoisted(() => vi.fn());
vi.mock("@/lib/c64api", () => ({ getC64API: () => ({ getConfigItem }) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { useDeviceColorScheme } from "@/hooks/useDeviceColorScheme";

describe("useDeviceColorScheme", () => {
  beforeEach(() => {
    connectionState.isConnected = false;
    getConfigItem.mockReset();
  });

  it("starts at null before any connection", () => {
    const { result } = renderHook(() => useDeviceColorScheme());
    expect(result.current.colorScheme).toBeNull();
    expect(getConfigItem).not.toHaveBeenCalled();
  });

  it("fetches once on the disconnected-to-connected transition (spec.md section 7.4)", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "Ultimate Black" } },
    });
    const { result, rerender } = renderHook(() => useDeviceColorScheme());

    connectionState.isConnected = true;
    rerender();

    await vi.waitFor(() => expect(result.current.colorScheme).toBe("Ultimate Black"));
    expect(getConfigItem).toHaveBeenCalledTimes(1);
    expect(getConfigItem).toHaveBeenCalledWith("User Interface Settings", "Color Scheme", {
      __c64uIntent: "background",
    });
  });

  it("does not re-fetch on a re-render that stays connected (never polls)", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "C128 Style" } },
    });
    connectionState.isConnected = true;
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    await vi.waitFor(() => expect(result.current.colorScheme).toBe("C128 Style"));

    rerender();
    rerender();
    expect(getConfigItem).toHaveBeenCalledTimes(1);
  });

  it("clears the cached value on disconnect", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "Commodore Blue" } },
    });
    connectionState.isConnected = true;
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    await vi.waitFor(() => expect(result.current.colorScheme).toBe("Commodore Blue"));

    connectionState.isConnected = false;
    rerender();
    expect(result.current.colorScheme).toBeNull();
  });

  it("re-fetches on the next connect after a disconnect", async () => {
    getConfigItem.mockResolvedValue({
      "User Interface Settings": { "Color Scheme": { selected: "Commodore 1" } },
    });
    connectionState.isConnected = true;
    const { result, rerender } = renderHook(() => useDeviceColorScheme());
    await vi.waitFor(() => expect(result.current.colorScheme).toBe("Commodore 1"));

    connectionState.isConnected = false;
    rerender();
    connectionState.isConnected = true;
    rerender();

    await vi.waitFor(() => expect(getConfigItem).toHaveBeenCalledTimes(2));
  });

  it("stays null when the config item is absent or the fetch fails", async () => {
    getConfigItem.mockRejectedValue(new Error("404"));
    connectionState.isConnected = true;
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
