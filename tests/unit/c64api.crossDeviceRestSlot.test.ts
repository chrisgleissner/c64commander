/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: { request: vi.fn() },
  Capacitor: {
    getPlatform: vi.fn(() => "web"),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({})),
}));

import { C64API } from "@/lib/c64api";
import { saveDeviceSafetyMode } from "@/lib/config/deviceSafetySettings";
import { resetDeviceActivityGate } from "@/lib/deviceInteraction/deviceActivityGate";
import { resetInteractionState } from "@/lib/deviceInteraction/deviceInteractionManager";
import { updateDeviceConnectionState } from "@/lib/deviceInteraction/deviceStateStore";

const UNREACHABLE_CONNECT_TIMEOUT_MS = 3000;

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith("http://u2/")) {
    return new Promise<Response>((_, reject) => {
      const timer = setTimeout(() => reject(new TypeError("Failed to fetch")), UNREACHABLE_CONNECT_TIMEOUT_MS);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }
  return new Response(Uint8Array.from([0x42]).buffer, {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
});

describe("REST slot across saved devices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
    localStorage.clear();
    saveDeviceSafetyMode("CONSERVATIVE");
    updateDeviceConnectionState("REAL_CONNECTED");
    resetDeviceActivityGate();
    resetInteractionState("test");
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    resetInteractionState("test-cleanup");
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockClear();
  });

  it("answers a reachable device's readMemory while a saved device that does not answer is still being probed", async () => {
    const unreachable = new C64API("http://u2", undefined, "u2");
    const reachable = new C64API("http://c64u", undefined, "c64u");

    const unreachableInfo = unreachable
      .getInfo({ __c64uIntent: "system", __c64uBypassCache: true, timeoutMs: UNREACHABLE_CONNECT_TIMEOUT_MS })
      .then(
        () => "answered",
        () => "failed",
      );
    await vi.advanceTimersByTimeAsync(0);
    let rasterSettled = false;
    const raster = reachable.readMemory("D012", 1, { __c64uIntent: "system", timeoutMs: 1500 }).finally(() => {
      rasterSettled = true;
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(rasterSettled).toBe(true);
    await expect(raster).resolves.toEqual(Uint8Array.from([0x42]));
    await vi.advanceTimersByTimeAsync(UNREACHABLE_CONNECT_TIMEOUT_MS * 2);
    await expect(unreachableInfo).resolves.toBe("failed");
  });
});
