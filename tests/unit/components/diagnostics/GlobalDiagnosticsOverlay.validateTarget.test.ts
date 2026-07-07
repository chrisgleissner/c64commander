import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalDiagnosticsOverlay, validateTarget } from "@/components/diagnostics/GlobalDiagnosticsOverlay";
import { C64API } from "@/lib/c64api";

describe("validateTarget", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    });
  });

  it("uses gateway getInfo and preserves the success shape without a raw fetch fallback", async () => {
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockResolvedValue({ model: "u64" } as never);

    await expect(validateTarget("office-u64", 80)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        normalizedHost: "office-u64",
        status: 200,
        body: { model: "u64" },
        errorMessage: null,
      }),
    );

    expect(getInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 4000,
        __c64uIntent: "user",
        __c64uAllowDuringError: true,
        __c64uBypassCache: true,
      }),
    );
    expect(getInfoSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({
        __c64uBypassCircuit: true,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    getInfoSpy.mockRestore();
  });

  it("preserves the failure shape returned by the gateway probe", async () => {
    const getInfoSpy = vi
      .spyOn(C64API.prototype, "getInfo")
      .mockRejectedValue(new Error("HTTP 503 Service Unavailable"));

    await expect(validateTarget("office-u64", 80)).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        normalizedHost: "office-u64",
        status: 503,
        body: null,
        errorMessage: "HTTP 503 Service Unavailable",
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();

    getInfoSpy.mockRestore();
  });

  it("keeps the overlay module importable for component consumers", () => {
    expect(GlobalDiagnosticsOverlay).toBeTypeOf("function");
  });

  // HARD18-027: host may already carry its own embedded port (e.g. a stored
  // device string produced by buildDeviceHostWithHttpPort). Naive
  // concatenation with the passed-in `port` produced a malformed
  // "host:port:port" authority that guaranteed failure for every
  // custom-HTTP-port device. The embedded port must win.
  it("composes the embedded port from host, ignoring a mismatched passed-in port", async () => {
    let capturedBaseUrl: string | null = null;
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockImplementation(function (
      this: InstanceType<typeof C64API>,
    ) {
      capturedBaseUrl = this.getBaseUrl();
      return Promise.resolve({ model: "u64" } as never);
    });

    await expect(validateTarget("10.0.0.2:8080", 80)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        normalizedHost: "10.0.0.2",
      }),
    );

    expect(capturedBaseUrl).toBe("http://10.0.0.2:8080");

    getInfoSpy.mockRestore();
  });

  it("falls back to the passed-in port when host has no embedded port", async () => {
    let capturedBaseUrl: string | null = null;
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockImplementation(function (
      this: InstanceType<typeof C64API>,
    ) {
      capturedBaseUrl = this.getBaseUrl();
      return Promise.resolve({ model: "u64" } as never);
    });

    await expect(validateTarget("office-u64", 8080)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        normalizedHost: "office-u64",
      }),
    );

    expect(capturedBaseUrl).toBe("http://office-u64:8080");

    getInfoSpy.mockRestore();
  });
});
