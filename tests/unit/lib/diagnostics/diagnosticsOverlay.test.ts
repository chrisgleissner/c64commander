/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestDiagnosticsOpen, consumeDiagnosticsOpenRequest } from "@/lib/diagnostics/diagnosticsOverlay";

describe("diagnosticsOverlay", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      CustomEvent: class CustomEvent {
        constructor(
          public type: string,
          public detail?: any,
        ) {}
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("requestDiagnosticsOpen", () => {
    it("persists preset to sessionStorage and dispatches event", () => {
      requestDiagnosticsOpen("header");
      expect(sessionStorage.setItem).toHaveBeenCalledWith("c64u_diagnostics_open_preset", "header");

      expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
      const event = vi.mocked(window.dispatchEvent).mock.calls[0][0] as any;
      expect(event.type).toBe("c64u-diagnostics-open-request");
      expect(event.detail).toEqual({ preset: "header" });
    });

    it("handles sessionStorage errors gracefully", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(sessionStorage.setItem).mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });

      requestDiagnosticsOpen("header");

      expect(warnSpy).toHaveBeenCalledWith("Unable to persist diagnostics open request:", expect.any(Error));
      expect(window.dispatchEvent).toHaveBeenCalled(); // Should still dispatch
    });

    it("does nothing if window is undefined", () => {
      vi.stubGlobal("window", undefined);
      requestDiagnosticsOpen("header");
      // If window is undefined, it should just return.
      // We can't easily assert "nothing happened" other than no side effects on globals we just removed.
    });
  });

  describe("consumeDiagnosticsOpenRequest", () => {
    it("retrieves and removes preset from sessionStorage", () => {
      vi.mocked(sessionStorage.getItem).mockReturnValue("header");

      const result = consumeDiagnosticsOpenRequest();

      expect(result).toBe("header");
      expect(sessionStorage.removeItem).toHaveBeenCalledWith("c64u_diagnostics_open_preset");
    });

    it("returns null if no tab in storage", () => {
      vi.mocked(sessionStorage.getItem).mockReturnValue(null);
      expect(consumeDiagnosticsOpenRequest()).toBeNull();
    });

    it("handles sessionStorage errors gracefully", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(sessionStorage.getItem).mockImplementation(() => {
        throw new Error("AccessDenied");
      });

      expect(consumeDiagnosticsOpenRequest()).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Unable to consume diagnostics open request:", expect.any(Error));
    });

    it("returns null if window is undefined", () => {
      vi.stubGlobal("window", undefined);
      expect(consumeDiagnosticsOpenRequest()).toBeNull();
    });
  });
});
