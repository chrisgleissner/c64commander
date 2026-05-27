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
});
