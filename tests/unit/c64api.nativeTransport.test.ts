/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { C64API } from "@/lib/c64api";
import { CapacitorHttp } from "@capacitor/core";

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: {
    request: vi.fn(),
  },
  Capacitor: {
    getPlatform: vi.fn(() => "android"),
    isNativePlatform: vi.fn(() => true),
  },
  registerPlugin: vi.fn(() => ({})),
}));

// Non-local host so the request takes the native direct-device transport branch
// (127.0.0.1 / localhost are treated as the web proxy).
const DEVICE_BASE = "http://192.168.1.50";
const infoPayload = { product: "C64 Ultimate", firmware_version: "1.1.0", errors: [] };

describe("C64API native device transport (BUG-066: reboot stale-connection recovery)", () => {
  const originalFetch = global.fetch;
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(infoPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  beforeEach(() => {
    vi.mocked(CapacitorHttp.request).mockReset();
    fetchSpy.mockClear();
    global.fetch = fetchSpy as unknown as typeof fetch;
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__;
  });

  it("routes native device GET through CapacitorHttp.request with a native connect/read timeout", async () => {
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      headers: { "Content-Type": "application/json" },
      data: infoPayload,
      url: `${DEVICE_BASE}/v1/info`,
    } as never);

    const api = new C64API(DEVICE_BASE, undefined, "192.168.1.50");
    const info = await api.getInfo({ timeoutMs: 1500, __c64uIntent: "system", __c64uBypassCache: true } as never);

    expect(info.firmware_version).toBe("1.1.0");
    // The whole point of the fix: a real native timeout is set so a dead pooled
    // connection fails fast and OkHttp evicts it (the patched window.fetch sets none).
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(CapacitorHttp.request).toHaveBeenCalledTimes(1);
    const call = vi.mocked(CapacitorHttp.request).mock.calls[0][0];
    expect(String(call.url)).toContain("/v1/info");
    expect(call.method).toBe("GET");
    expect(call.connectTimeout).toBe(1500);
    expect(call.readTimeout).toBe(1500);
  });

  it("fails fast on a native socket timeout, then recovers on the next request (fresh connection)", async () => {
    vi.mocked(CapacitorHttp.request)
      .mockRejectedValueOnce(new Error("Read timed out"))
      .mockResolvedValue({
        status: 200,
        headers: { "Content-Type": "application/json" },
        data: infoPayload,
        url: `${DEVICE_BASE}/v1/info`,
      } as never);

    const api = new C64API(DEVICE_BASE, undefined, "192.168.1.50");

    // First probe reuses the dead pooled connection -> native read timeout -> rejects
    // (instead of hanging forever as it did with the patched fetch + infinite timeout).
    await expect(
      api.getInfo({ timeoutMs: 1500, __c64uIntent: "system", __c64uBypassCache: true } as never),
    ).rejects.toThrow();

    // Next probe opens a fresh connection and succeeds: the app recovers on its own.
    const info = await api.getInfo({ timeoutMs: 1500, __c64uIntent: "system", __c64uBypassCache: true } as never);
    expect(info.firmware_version).toBe("1.1.0");
    expect(CapacitorHttp.request).toHaveBeenCalledTimes(2);
  });

  it("still uses standard fetch on web (non-native) platforms", async () => {
    delete (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__;
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = false;

    const api = new C64API(DEVICE_BASE, undefined, "192.168.1.50");
    await api.getInfo({ timeoutMs: 1500, __c64uIntent: "system", __c64uBypassCache: true } as never);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(CapacitorHttp.request).not.toHaveBeenCalled();
  });
});
