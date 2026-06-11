/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs/promises";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  reportUserError,
  clearToastForSuccessfulOperation,
  clearToastsOnDeviceSwitch,
  clearConnectivityErrorToastsForHost,
  __clearDedupStateForTests,
} from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";

// Mock dependencies
vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: vi.fn(() => ({ devices: [], selectedDeviceId: null })),
}));

describe("uiErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearDedupStateForTests();
  });

  it("reports basic error to log and toast", () => {
    reportUserError({
      operation: "TEST_OP",
      title: "Something failed",
      description: "Please try again",
    });

    expect(addErrorLog).toHaveBeenCalledWith("TEST_OP: Something failed", {
      operation: "TEST_OP",
      description: "Please try again",
      error: undefined,
    });

    expect(toast).toHaveBeenCalledWith({
      title: "Something failed",
      description: "Please try again",
      variant: "destructive",
    });
  });

  it("includes context in error log", () => {
    reportUserError({
      operation: "TEST_OP",
      title: "Error",
      description: "Desc",
      context: { userId: 123, action: "save" },
    });

    expect(addErrorLog).toHaveBeenCalledWith(
      expect.stringContaining("TEST_OP"),
      expect.objectContaining({
        userId: 123,
        action: "save",
      }),
    );
  });

  describe("error object processing", () => {
    it("handles Error instances", () => {
      const error = new Error("System crash");
      error.stack = "Error: System crash\n    at test.ts:1:1";

      reportUserError({
        operation: "TEST_crash",
        title: "Crash",
        description: "Boom",
        error,
      });

      expect(addErrorLog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: {
            name: "Error",
            message: "System crash",
            stack: "Error: System crash\n    at test.ts:1:1",
          },
        }),
      );
    });

    it("handles string errors", () => {
      reportUserError({
        operation: "TEST_string",
        title: "Str",
        description: "Desc",
        error: "Network timeout",
      });

      expect(addErrorLog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: { message: "Network timeout" },
        }),
      );
    });

    it("handles object errors", () => {
      const customErr = { code: 500, detail: "Server error" };
      reportUserError({
        operation: "TEST_obj",
        title: "Obj",
        description: "Desc",
        error: customErr,
      });

      expect(addErrorLog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: { code: 500, detail: "Server error" },
        }),
      );
    });

    it("handles unknown primitives", () => {
      reportUserError({
        operation: "TEST_prim",
        title: "Prim",
        description: "Desc",
        error: 42,
      });

      expect(addErrorLog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: { message: "42" },
        }),
      );
    });
  });

  it("includes a Retry action in the toast when retry callback is provided", () => {
    const retry = vi.fn();
    reportUserError({
      operation: "HOME_SID_VOLUME",
      title: "Update failed",
      description: "Host unreachable",
      retry,
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ type: expect.anything() }),
      }),
    );
  });

  it("omits action from toast when no retry callback is provided", () => {
    reportUserError({
      operation: "HOME_SID_VOLUME",
      title: "Update failed",
      description: "Network error",
    });

    const toastCall = (toast as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(toastCall).not.toHaveProperty("action");
  });

  it("skips logging and toast when error has already been handled", () => {
    const handledError = Object.assign(new Error("handled"), { c64uHandled: true });
    reportUserError({
      operation: "TEST_OP",
      title: "Should not show",
      description: "Already handled",
      error: handledError,
    });

    expect(addErrorLog).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("uses error log with recoverableConnectivityIssue flag for connectivity errors", () => {
    reportUserError({
      operation: "HOME_CPU_SPEED",
      title: "Update failed",
      description: "Host unreachable",
      error: new Error("HTTP 503: Service Unavailable"),
    });

    expect(addErrorLog).toHaveBeenCalledWith(
      "HOME_CPU_SPEED: Update failed",
      expect.objectContaining({ recoverableConnectivityIssue: true }),
    );
    expect(addLog).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
  });

  describe("ERROR_POLICY §3 — background operations are S0 (log only, never toast)", () => {
    it("suppresses toast when background is true and logs with suppressedReason", () => {
      reportUserError({
        operation: "HEALTH_PROBE",
        title: "Device offline",
        description: "Connection refused",
        background: true,
      });

      expect(toast).not.toHaveBeenCalled();
      expect(addErrorLog).toHaveBeenCalledWith(
        "HEALTH_PROBE: Device offline",
        expect.objectContaining({ suppressedReason: "background-operation" }),
      );
    });

    it("background health-check paths contain no reportUserError or toast calls (regression guard)", async () => {
      const [hcSource, hceSource] = await Promise.all([
        fs.readFile("src/hooks/useSavedDeviceHealthChecks.ts", "utf8"),
        fs.readFile("src/lib/diagnostics/healthCheckEngine.ts", "utf8"),
      ]);
      expect(hcSource, "useSavedDeviceHealthChecks must not call reportUserError").not.toMatch(/reportUserError/);
      expect(hcSource, "useSavedDeviceHealthChecks must not call toast directly").not.toMatch(/\btoast\s*\(/);
      expect(hceSource, "healthCheckEngine must not call reportUserError").not.toMatch(/reportUserError/);
      expect(hceSource, "healthCheckEngine must not call toast directly").not.toMatch(/\btoast\s*\(/);
    });
  });

  describe("ERROR_POLICY §5 — dedup: same key within 30 s produces one toast (H-04)", () => {
    it("deduplicates repeated errors with same operation and deviceHost within 30 seconds", () => {
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: vi.fn(), update: vi.fn() });

      reportUserError({
        operation: "LOAD_FILE",
        title: "Error",
        description: "Host unreachable",
        deviceHost: "u64",
      });
      reportUserError({
        operation: "LOAD_FILE",
        title: "Error",
        description: "Host unreachable",
        deviceHost: "u64",
      });

      expect(toast).toHaveBeenCalledTimes(1);
    });

    it("does not record a dedup entry when the toast layer suppresses the notice", () => {
      const suppressedDismiss = vi.fn();
      vi.mocked(toast).mockReturnValue({ id: "", dismiss: suppressedDismiss, update: vi.fn() });

      reportUserError({
        operation: "LOAD_FILE",
        title: "Notice",
        description: "Background notice",
        severity: "S2",
        deviceHost: "u64",
      });
      reportUserError({
        operation: "LOAD_FILE",
        title: "Notice",
        description: "Background notice",
        severity: "S2",
        deviceHost: "u64",
      });
      clearToastForSuccessfulOperation("LOAD_FILE", "u64");

      expect(toast).toHaveBeenCalledTimes(2);
      expect(suppressedDismiss).not.toHaveBeenCalled();
    });

    it("logs every occurrence even when toast is deduplicated", () => {
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: vi.fn(), update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });
      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });

      expect(addErrorLog).toHaveBeenCalledTimes(2);
    });

    it("creates a new toast after the dedup window expires", () => {
      vi.useFakeTimers();
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: vi.fn(), update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });
      vi.advanceTimersByTime(31_000);
      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });

      expect(toast).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe("ERROR_POLICY §6 — stale-clear: error toast dismissed on success (H-03)", () => {
    it("clearToastForSuccessfulOperation dismisses the matching live error toast", () => {
      const mockDismiss = vi.fn();
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: mockDismiss, update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "Error", description: "Network error", deviceHost: "u64" });
      clearToastForSuccessfulOperation("LOAD_FILE", "u64");

      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });

    it("clearToastForSuccessfulOperation does nothing when no matching toast exists", () => {
      expect(() => clearToastForSuccessfulOperation("LOAD_FILE", "u64")).not.toThrow();
    });

    it("clearToastsOnDeviceSwitch dismisses all toasts attributed to the switching-away device", () => {
      const mockDismiss = vi.fn();
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: mockDismiss, update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "Error", description: "Network error", deviceHost: "u64" });
      clearToastsOnDeviceSwitch("u64");

      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });

    it("clearToastsOnDeviceSwitch does not dismiss toasts from a different device", () => {
      const mockDismiss = vi.fn();
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: mockDismiss, update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "Error", description: "Network error", deviceHost: "u64" });
      clearToastsOnDeviceSwitch("c64u"); // different device

      expect(mockDismiss).not.toHaveBeenCalled();
    });

    it("normalizes host attribution (protocol/port/case) so clears match", () => {
      const mockDismiss = vi.fn();
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: mockDismiss, update: vi.fn() });

      reportUserError({
        operation: "LOAD_FILE",
        title: "Error",
        description: "Network error",
        deviceHost: "http://U64:80",
      });
      clearToastsOnDeviceSwitch("u64");

      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });

    it("clearConnectivityErrorToastsForHost dismisses only connectivity-class toasts for that host", () => {
      const connectivityDismiss = vi.fn();
      const otherDismiss = vi.fn();
      vi.mocked(toast).mockReturnValueOnce({ id: "1", dismiss: connectivityDismiss, update: vi.fn() });
      vi.mocked(toast).mockReturnValueOnce({ id: "2", dismiss: otherDismiss, update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });
      reportUserError({ operation: "SAVE_CONFIG", title: "E", description: "Invalid value", deviceHost: "u64" });

      clearConnectivityErrorToastsForHost("u64");

      expect(connectivityDismiss).toHaveBeenCalledTimes(1);
      expect(otherDismiss).not.toHaveBeenCalled();
    });
  });

  describe("ERROR_POLICY §3/§6 — default attribution to the active saved device", () => {
    it("attributes unhosted errors to the active device so device switch clears them", () => {
      vi.mocked(getSavedDevicesSnapshot).mockReturnValue({
        devices: [{ id: "dev-1", host: "U64" }],
        selectedDeviceId: "dev-1",
      } as never);
      const mockDismiss = vi.fn();
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: mockDismiss, update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "Error", description: "Network error" });
      clearToastsOnDeviceSwitch("u64");

      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });

    it("leaves attribution empty when no device is selected", () => {
      vi.mocked(getSavedDevicesSnapshot).mockReturnValue({ devices: [], selectedDeviceId: null } as never);
      const mockDismiss = vi.fn();
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: mockDismiss, update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "Error", description: "Network error" });
      clearToastsOnDeviceSwitch("u64");

      expect(mockDismiss).not.toHaveBeenCalled();
    });
  });

  describe("ERROR_POLICY §5 — retry-storm escalation in diagnostics", () => {
    it("logs duplicate occurrences with suppressedReason and a growing occurrenceCount", () => {
      vi.mocked(toast).mockReturnValue({ id: "1", dismiss: vi.fn(), update: vi.fn() });

      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });
      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });
      reportUserError({ operation: "LOAD_FILE", title: "E", description: "Host unreachable", deviceHost: "u64" });

      expect(toast).toHaveBeenCalledTimes(1);
      expect(addErrorLog).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ suppressedReason: "duplicate-toast-deduped", occurrenceCount: 2 }),
      );
      expect(addErrorLog).toHaveBeenNthCalledWith(
        3,
        expect.any(String),
        expect.objectContaining({ suppressedReason: "duplicate-toast-deduped", occurrenceCount: 3 }),
      );
    });
  });
});
