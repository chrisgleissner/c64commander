/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks (accessible in vi.mock factories) ─────────────────────────

const {
  mockGetInfo,
  mockReadMemory,
  mockGetConfigItem,
  mockSetConfigValue,
  mockLoadConfig,
  mockListFtpDirectory,
  mockTelnetConnect,
  mockTelnetReadScreen,
  mockTelnetDisconnect,
} = vi.hoisted(() => ({
  mockGetInfo: vi.fn(),
  mockReadMemory: vi.fn(),
  mockGetConfigItem: vi.fn(),
  mockSetConfigValue: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockListFtpDirectory: vi.fn(),
  mockTelnetConnect: vi.fn(),
  mockTelnetReadScreen: vi.fn(),
  mockTelnetDisconnect: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

vi.mock("@/lib/diagnostics/latencyTracker", () => ({
  computeLatencyPercentiles: vi.fn(() => ({ p50: 10, p90: 20, p99: 30 })),
}));

vi.mock("@/lib/diagnostics/healthHistory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/diagnostics/healthHistory")>();
  return { ...actual, pushHealthHistoryEntry: vi.fn() };
});

vi.mock("@/lib/diagnostics/healthModel", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/diagnostics/healthModel")>();
  return {
    ...mod,
    deriveConnectivityState: vi.fn(() => "Online"),
  };
});

vi.mock("@/lib/c64api", () => ({
  C64API: vi.fn().mockImplementation(() => ({
    getInfo: mockGetInfo,
    readMemory: mockReadMemory,
    getConfigItem: mockGetConfigItem,
    setConfigValue: mockSetConfigValue,
    loadConfig: mockLoadConfig,
  })),
  getC64API: vi.fn(() => ({
    getInfo: mockGetInfo,
    readMemory: mockReadMemory,
    getConfigItem: mockGetConfigItem,
    setConfigValue: mockSetConfigValue,
    loadConfig: mockLoadConfig,
  })),
  getC64APIConfigSnapshot: vi.fn(() => ({ deviceHost: "c64u.local" })),
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: mockListFtpDirectory,
}));

vi.mock("@/lib/telnet/telnetClient", () => ({
  createTelnetClient: vi.fn(() => ({ mocked: true })),
}));

vi.mock("@/lib/telnet/telnetSession", () => ({
  createTelnetSession: vi.fn(() => ({
    connect: mockTelnetConnect,
    readScreen: mockTelnetReadScreen,
    disconnect: mockTelnetDisconnect,
  })),
}));

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  normalizeFtpHost: vi.fn((host: string) => {
    if (!host) return host;
    if (host.startsWith("[")) {
      const end = host.indexOf("]");
      if (end !== -1) return host.slice(0, end + 1);
    }
    return host.split(":")[0] ?? host;
  }),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: vi.fn(() => 21),
}));

vi.mock("@/lib/telnet/telnetConfig", () => ({
  getStoredTelnetPort: vi.fn(() => 23),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: vi.fn(() => ({ state: "REAL_CONNECTED" })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { getC64APIConfigSnapshot } from "@/lib/c64api";
import {
  cancelHealthCheck,
  isHealthCheckRunning,
  recoverStaleHealthCheckRun,
  runHealthCheck,
  runHealthCheckForTarget,
} from "@/lib/diagnostics/healthCheckEngine";
import { clearHealthHistory } from "@/lib/diagnostics/healthHistory";
import { getHealthCheckStateSnapshot, resetHealthCheckStateSnapshot } from "@/lib/diagnostics/healthCheckState";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const successfulInfo = {
  product: "Ultimate 64 Elite",
  firmware_version: "3.11",
  fpga_version: "1.42",
  core_version: "C64",
  errors: [],
};

// A valid 3-byte JIFFY response: jiffy = 0 | (0x3C << 8) | 0 = 15360 → floor(15360/60) = 256 s
const jiffyBytes = new Uint8Array([0x00, 0x3c, 0x00]);

const ledResp = { "LED Strip Settings": { "Strip Intensity": { selected: 5 } } };
const ledReadbackResp = { "LED Strip Settings": { "Strip Intensity": { selected: 6 } } };
const telnetScreen = {
  width: 60,
  height: 24,
  cells: [],
  menus: [],
  form: null,
  selectedItem: null,
  titleLine: "Ultimate-II+ V3.11 - C64 Ultimate",
  screenType: "file_browser" as const,
};

const setupAllProbesSuccess = () => {
  mockGetInfo.mockResolvedValue(successfulInfo);
  mockReadMemory.mockImplementation((addr: string) => {
    if (addr === "00A2") return Promise.resolve(jiffyBytes);
    if (addr === "D012") return Promise.resolve(new Uint8Array([0x42]));
    return Promise.resolve(new Uint8Array(0));
  });
  mockGetConfigItem
    .mockResolvedValueOnce(ledResp) // initial read: value=5
    .mockResolvedValueOnce(ledReadbackResp) // readback: value=6
    .mockResolvedValueOnce(ledResp); // verify revert: value=5
  mockSetConfigValue.mockResolvedValue(undefined);
  mockListFtpDirectory.mockResolvedValue([]);
  mockTelnetConnect.mockResolvedValue(undefined);
  mockTelnetReadScreen.mockResolvedValue(telnetScreen);
  mockTelnetDisconnect.mockResolvedValue(undefined);
};

beforeEach(() => {
  mockGetInfo.mockReset();
  mockReadMemory.mockReset();
  mockGetConfigItem.mockReset();
  mockSetConfigValue.mockReset();
  mockLoadConfig.mockReset();
  mockListFtpDirectory.mockReset();
  mockTelnetConnect.mockReset();
  mockTelnetReadScreen.mockReset();
  mockTelnetDisconnect.mockReset();
  vi.clearAllMocks();
  clearHealthHistory();
  resetHealthCheckStateSnapshot();
  vi.mocked(getC64APIConfigSnapshot).mockReturnValue({ deviceHost: "c64u.local" });
});

afterEach(() => {
  cancelHealthCheck("Test cleanup");
  resetHealthCheckStateSnapshot();
  vi.clearAllMocks();
});

// ─── isHealthCheckRunning ─────────────────────────────────────────────────────

describe("isHealthCheckRunning", () => {
  it("returns false when no run is in progress", () => {
    expect(isHealthCheckRunning()).toBe(false);
  });
});

describe("health-check lifecycle helpers", () => {
  it("returns false when attempting to recover a run that is not stale", () => {
    expect(recoverStaleHealthCheckRun()).toBe(false);
  });

  it("returns false when cancelling without an active run", () => {
    expect(cancelHealthCheck()).toBe(false);
  });
});

// ─── runHealthCheck — all-success path ───────────────────────────────────────

describe("runHealthCheck — all-success path", () => {
  it("returns a run result with all probes succeeded", async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result).not.toBeNull();
    expect(result!.probes.REST.outcome).toBe("Success");
    expect(result!.probes.JIFFY.outcome).toBe("Success");
    expect(result!.probes.CONFIG.outcome).toBe("Success");
    expect(result!.probes.FTP.outcome).toBe("Success");
    expect(result!.probes.TELNET.outcome).toBe("Success");
  });

  it("returns overallHealth Healthy when all probes pass", async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.overallHealth).toBe("Healthy");
  });

  it("extracts deviceInfo from REST probe", async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.deviceInfo?.product).toBe("Ultimate 64 Elite");
    expect(result!.deviceInfo?.firmware).toBe("3.11");
  });

  it("derives uptime from JIFFY bytes", async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    // jiffy = 0x00 | (0x3C << 8) | (0x00 << 16) = 15360 → floor(15360/60) = 256
    expect(result!.deviceInfo?.uptimeSeconds).toBe(256);
  });

  it("returns runId, startTimestamp, endTimestamp fields", async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.runId).toMatch(/^hcr-/);
    expect(result!.startTimestamp).toBeTruthy();
    expect(result!.endTimestamp).toBeTruthy();
  });

  it("returns latency data from computeLatencyPercentiles", async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.latency).toEqual({ p50: 10, p90: 20, p99: 30 });
  });

  it("restarts an in-flight run and records cancellation for the superseded run", async () => {
    let rejectFirstGetInfo: ((reason?: unknown) => void) | null = null;
    const firstGetInfo = new Promise<typeof successfulInfo>((_resolve, reject) => {
      rejectFirstGetInfo = reject;
    });
    mockGetInfo.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      signal?.addEventListener("abort", () => rejectFirstGetInfo?.(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
      return firstGetInfo;
    });
    setupAllProbesSuccess();

    const firstRun = runHealthCheck();
    expect(isHealthCheckRunning()).toBe(true);

    const secondRun = await runHealthCheck();
    const firstResult = await firstRun;
    const snapshot = getHealthCheckStateSnapshot();

    expect(firstResult).toBeNull();
    expect(secondRun).not.toBeNull();
    expect(snapshot.currentRunId).toBe(secondRun?.runId ?? null);
    expect(snapshot.runState).not.toBe("CANCELLED");
    expect(
      snapshot.transitions.some(
        (entry) => entry.to === "CANCELLED" && entry.reason === "Superseded by a new health check run",
      ),
    ).toBe(true);
  });

  it("marks a stale run as timed out and clears the running flag", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const startNow = 1_000_000;
    dateNowSpy.mockReturnValue(startNow);

    let rejectPendingGetInfo: ((reason?: unknown) => void) | null = null;
    const pendingGetInfo = new Promise<typeof successfulInfo>((_resolve, reject) => {
      rejectPendingGetInfo = reject;
    });
    mockGetInfo.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
      signal?.addEventListener("abort", () => rejectPendingGetInfo?.(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
      return pendingGetInfo;
    });

    void pendingGetInfo;
    const runPromise = runHealthCheck();
    expect(getHealthCheckStateSnapshot().runState).toBe("RUNNING");

    const staleAfter = getHealthCheckStateSnapshot().staleAfterMs;
    expect(staleAfter).not.toBeNull();
    dateNowSpy.mockReturnValue((staleAfter ?? startNow) + 1);

    expect(recoverStaleHealthCheckRun()).toBe(true);
    expect(getHealthCheckStateSnapshot().runState).toBe("TIMEOUT");
    expect(getHealthCheckStateSnapshot().running).toBe(false);

    await expect(runPromise).resolves.toBeNull();
    dateNowSpy.mockRestore();
  });

  it("cancels an active run and marks the lifecycle as CANCELLED", async () => {
    let rejectPendingGetInfo: ((reason?: unknown) => void) | null = null;
    const pendingGetInfo = new Promise<typeof successfulInfo>((_resolve, reject) => {
      rejectPendingGetInfo = reject;
    });
    mockGetInfo.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
      signal?.addEventListener("abort", () => rejectPendingGetInfo?.(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
      return pendingGetInfo;
    });

    const runPromise = runHealthCheck();
    expect(isHealthCheckRunning()).toBe(true);

    expect(cancelHealthCheck("Stopped by user")).toBe(true);
    expect(getHealthCheckStateSnapshot().runState).toBe("CANCELLED");
    expect(getHealthCheckStateSnapshot().running).toBe(false);

    await expect(runPromise).resolves.toBeNull();
  });
});

describe("runHealthCheckForTarget", () => {
  it("runs a passive per-device check without mutating config and uses target ports and password", async () => {
    setupAllProbesSuccess();

    const result = await runHealthCheckForTarget(
      {
        deviceHost: "backup-u64:8080",
        ftpPort: 2021,
        telnetPort: 2323,
        password: "secret",
      },
      { mode: "passive" },
    );

    expect(result.connectivity).toBe("Online");
    expect(result.probes.CONFIG.outcome).toBe("Skipped");
    expect(result.probes.CONFIG.reason).toContain("passive switcher checks");
    expect(mockSetConfigValue).not.toHaveBeenCalled();
    expect(mockListFtpDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ host: "backup-u64", port: 2021, password: "secret" }),
    );
    expect(mockTelnetConnect).toHaveBeenCalledWith("backup-u64", 2323, "secret");
  });
});

// ─── runHealthCheck — REST probe failure ─────────────────────────────────────

describe("runHealthCheck — REST probe failure", () => {
  it("skips JIFFY, RASTER, CONFIG when REST fails", async () => {
    mockGetInfo.mockRejectedValue(new Error("Network error"));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.outcome).toBe("Fail");
    expect(result!.probes.JIFFY.outcome).toBe("Skipped");
    expect(result!.probes.RASTER.outcome).toBe("Skipped");
    expect(result!.probes.CONFIG.outcome).toBe("Skipped");
  });

  it("skips FTP when REST fails (FTP now depends on REST)", async () => {
    mockGetInfo.mockRejectedValue(new Error("Network error"));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.FTP.outcome).toBe("Skipped");
  });

  it("skips TELNET when REST fails", async () => {
    mockGetInfo.mockRejectedValue(new Error("Connection refused"));

    const result = await runHealthCheck();
    expect(result!.probes.TELNET.outcome).toBe("Skipped");
  });

  it("sets REST Fail reason from error message", async () => {
    mockGetInfo.mockRejectedValue(new Error("Connection refused"));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.reason).toContain("Connection refused");
  });

  it("sets Unhealthy overallHealth when REST fails", async () => {
    mockGetInfo.mockRejectedValue(new Error("timeout"));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.overallHealth).toBe("Unhealthy");
  });
});

// ─── runHealthCheck — JIFFY probe ────────────────────────────────────────────

describe("runHealthCheck — JIFFY probe", () => {
  it("fails JIFFY when fewer than 3 bytes returned", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(new Uint8Array([0x01]));
      if (addr === "D012") return Promise.resolve(new Uint8Array([0x42]));
      return Promise.resolve(new Uint8Array(0));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.JIFFY.outcome).toBe("Fail");
    expect(result!.probes.JIFFY.reason).toContain("Expected 3 bytes");
  });

  it("fails JIFFY when readMemory throws", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.reject(new Error("Read failed"));
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.JIFFY.outcome).toBe("Fail");
  });
});

// ─── runHealthCheck — RASTER probe (optional) ────────────────────────────────

describe("runHealthCheck — RASTER probe", () => {
  it("skips RASTER when readMemory returns empty bytes", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      if (addr === "D012") return Promise.resolve(new Uint8Array(0));
      return Promise.resolve(new Uint8Array(0));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.RASTER.outcome).toBe("Skipped");
  });

  it("skips RASTER when readMemory throws (unsupported)", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.reject(new Error("Unsupported register"));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.RASTER.outcome).toBe("Skipped");
  });
});

// ─── runHealthCheck — CONFIG probe ───────────────────────────────────────────

describe("runHealthCheck — CONFIG probe", () => {
  it("fails CONFIG when readback value does not match written value", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // Initial read=5, writeTemp=6, but readback returns 5 → mismatch
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp) // initial: 5
      .mockResolvedValueOnce(ledResp) // readback: still 5, expected 6
      .mockResolvedValueOnce(ledResp); // verify
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Fail");
    expect(result!.probes.CONFIG.reason).toContain("Readback mismatch");
  });

  it("fails CONFIG when post-revert verify mismatches", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // Initial=5, readback=6 ok, verify=6 ≠ 5 → fail
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp) // initial: 5
      .mockResolvedValueOnce(ledReadbackResp) // readback: 6 ok
      .mockResolvedValueOnce(ledReadbackResp); // verify: 6 ≠ 5
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Fail");
    expect(result!.probes.CONFIG.reason).toContain("Post-revert mismatch");
  });

  it("skips CONFIG when no suitable target available", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem.mockResolvedValue({}); // both targets return empty → continue loop → Skipped
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Skipped");
  });

  it("falls back to Keyboard Lighting when LED Strip Settings is unavailable", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    const keyboardResp = { "Keyboard Lighting": { "Strip Intensity": { selected: 8 } } };
    const keyboardReadback = { "Keyboard Lighting": { "Strip Intensity": { selected: 9 } } };
    mockGetConfigItem.mockImplementation((category: string) => {
      if (category === "LED Strip Settings") return Promise.resolve({});
      if (category === "Keyboard Lighting") return Promise.resolve(keyboardResp);
      return Promise.resolve({});
    });
    mockGetConfigItem
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(keyboardResp)
      .mockResolvedValueOnce(keyboardReadback)
      .mockResolvedValueOnce(keyboardResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();

    expect(result!.probes.CONFIG.outcome).toBe("Success");
    expect(mockSetConfigValue).toHaveBeenNthCalledWith(
      1,
      "Keyboard Lighting",
      "Strip Intensity",
      9,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
  });

  it("round-trips config items that expose current/min/max fields from the real device schema", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    const currentResp = {
      "LED Strip Settings": {
        "Strip Intensity": {
          current: 13,
          min: 0,
          max: 31,
          format: "%d",
        },
      },
    };
    const currentReadbackResp = {
      "LED Strip Settings": {
        "Strip Intensity": {
          current: 14,
          min: 0,
          max: 31,
          format: "%d",
        },
      },
    };
    mockGetConfigItem
      .mockResolvedValueOnce(currentResp)
      .mockResolvedValueOnce(currentReadbackResp)
      .mockResolvedValueOnce(currentResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();

    expect(result!.probes.CONFIG.outcome).toBe("Success");
    expect(mockSetConfigValue).toHaveBeenNthCalledWith(
      1,
      "LED Strip Settings",
      "Strip Intensity",
      14,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
  });
});

// ─── runHealthCheck — REST probe with device errors ──────────────────────────

describe("runHealthCheck — REST probe device errors", () => {
  it("fails REST when info.errors array is non-empty", async () => {
    mockGetInfo.mockResolvedValue({
      ...successfulInfo,
      errors: ["Drive error", "Timeout"],
    });
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.outcome).toBe("Fail");
    expect(result!.probes.REST.reason).toContain("Device errors");
  });

  it("fails REST when product field is missing", async () => {
    mockGetInfo.mockResolvedValue({ ...successfulInfo, product: "" });
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.outcome).toBe("Fail");
    expect(result!.probes.REST.reason).toContain("No product info");
  });
});

// ─── runHealthCheck — CONFIG with numeric value ───────────────────────────────

describe("runHealthCheck — CONFIG probe numeric item format", () => {
  it("succeeds CONFIG when item data is a direct number (not { selected })", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // itemData is a number directly (not { selected })
    const directNumResp = { "LED Strip Settings": { "Strip Intensity": 5 } };
    const directNumReadbackResp = { "LED Strip Settings": { "Strip Intensity": 6 } };
    mockGetConfigItem
      .mockResolvedValueOnce(directNumResp)
      .mockResolvedValueOnce(directNumReadbackResp)
      .mockResolvedValueOnce(directNumResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Success");
  });

  it("succeeds CONFIG when selected value is a string (parseFloat path)", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // selected is a string
    const strResp = { "LED Strip Settings": { "Strip Intensity": { selected: "5" } } };
    const strReadbackResp = { "LED Strip Settings": { "Strip Intensity": { selected: "6" } } };
    mockGetConfigItem
      .mockResolvedValueOnce(strResp)
      .mockResolvedValueOnce(strReadbackResp)
      .mockResolvedValueOnce(strResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Success");
  });

  it("falls back to numeric parsing when string selections are not present in options", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    const numericWithMismatchedOptions = {
      "LED Strip Settings": {
        "Strip Intensity": {
          selected: "5",
          options: ["OFF", "DIM", "BRIGHT"],
        },
      },
    };
    const numericReadback = {
      "LED Strip Settings": {
        "Strip Intensity": {
          selected: "6",
          options: ["OFF", "DIM", "BRIGHT"],
        },
      },
    };
    mockGetConfigItem
      .mockResolvedValueOnce(numericWithMismatchedOptions)
      .mockResolvedValueOnce(numericReadback)
      .mockResolvedValueOnce(numericWithMismatchedOptions);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();

    expect(result!.probes.CONFIG.outcome).toBe("Success");
    expect(mockSetConfigValue).toHaveBeenNthCalledWith(
      1,
      "LED Strip Settings",
      "Strip Intensity",
      6,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
  });

  it("applies delta subtraction when currentValue is at max (31)", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // currentValue = 31 = max → tempValue = 31 - 1 = 30
    const maxResp = { "LED Strip Settings": { "Strip Intensity": { selected: 31 } } };
    const maxReadbackResp = { "LED Strip Settings": { "Strip Intensity": { selected: 30 } } };
    mockGetConfigItem
      .mockResolvedValueOnce(maxResp)
      .mockResolvedValueOnce(maxReadbackResp)
      .mockResolvedValueOnce(maxResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Success");
  });
});

// ─── runHealthCheck — FTP probe ───────────────────────────────────────────────

describe("runHealthCheck — FTP probe", () => {
  it("fails FTP when listFtpDirectory throws", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockRejectedValue(new Error("FTP connection refused"));

    const result = await runHealthCheck();
    expect(result!.probes.FTP.outcome).toBe("Fail");
    expect(result!.probes.FTP.reason).toContain("FTP connection refused");
  });

  it("marks the run TIMEOUT when the FTP probe times out", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockRejectedValue(new Error("FTP timed out after 1000ms"));

    const result = await runHealthCheck();

    expect(result!.probes.FTP.outcome).toBe("Fail");
    expect(result!.probes.FTP.durationMs).toBe(1000);
    expect(getHealthCheckStateSnapshot().runState).toBe("TIMEOUT");
  });

  it("normalizes an HTTP device host with a port before probing FTP", async () => {
    const { getC64APIConfigSnapshot } = await import("@/lib/c64api");
    vi.mocked(getC64APIConfigSnapshot).mockReturnValue({ deviceHost: "127.0.0.1:8080" });

    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();

    expect(result!.probes.FTP.outcome).toBe("Success");
    expect(mockListFtpDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 21,
        path: "/",
      }),
    );
  });
});

describe("runHealthCheck — TELNET probe", () => {
  it("fails TELNET when the session returns an unexpected screen title", async () => {
    setupAllProbesSuccess();
    mockTelnetReadScreen.mockResolvedValue({
      ...telnetScreen,
      titleLine: "Storage Browser",
    });

    const result = await runHealthCheck();

    expect(result!.probes.TELNET.outcome).toBe("Fail");
    expect(result!.probes.TELNET.reason).toContain("Unexpected Telnet screen");
  });

  it("fails TELNET when the session returns a blank screen title", async () => {
    setupAllProbesSuccess();
    mockTelnetReadScreen.mockResolvedValue({
      ...telnetScreen,
      titleLine: "   ",
    });

    const result = await runHealthCheck();

    expect(result!.probes.TELNET.outcome).toBe("Fail");
    expect(result!.probes.TELNET.reason).toBe("Unexpected blank Telnet screen");
  });

  it("fails TELNET when the session connect step throws", async () => {
    setupAllProbesSuccess();
    mockTelnetConnect.mockRejectedValue(new Error("Telnet connection refused"));

    const result = await runHealthCheck();

    expect(result!.probes.TELNET.outcome).toBe("Fail");
    expect(result!.probes.TELNET.reason).toContain("Telnet connection refused");
    expect(mockTelnetDisconnect).toHaveBeenCalled();
  });

  it("connects TELNET with the normalized host and configured password", async () => {
    setupAllProbesSuccess();
    vi.mocked(getC64APIConfigSnapshot).mockReturnValue({
      deviceHost: "10.0.0.2:6400",
      password: "secret",
    });

    await runHealthCheck();

    expect(mockTelnetConnect).toHaveBeenCalledWith("10.0.0.2", 23, "secret");
  });

  it("uses a shorter screen-read timeout so the probe fits inside the global telnet budget", async () => {
    setupAllProbesSuccess();

    await runHealthCheck();

    expect(mockTelnetReadScreen).toHaveBeenCalledWith(250);
  });
});

// ─── runHealthCheck — REST probe with undefined optional fields ───────────────

describe("runHealthCheck — REST probe optional fields", () => {
  it("uses null for firmware/fpga/core/product when info fields are undefined", async () => {
    mockGetInfo.mockResolvedValue({
      product: "Ultimate 64 Elite",
      errors: [],
      // firmware_version, fpga_version, core_version intentionally omitted
    });
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.outcome).toBe("Success");
    expect(result!.deviceInfo?.firmware).toBeNull();
    expect(result!.deviceInfo?.fpga).toBeNull();
    expect(result!.deviceInfo?.core).toBeNull();
  });

  it("sets product to null when info.product is undefined", async () => {
    mockGetInfo.mockResolvedValue({
      product: undefined,
      errors: [],
    });
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.outcome).toBe("Fail");
    expect(result!.probes.REST.reason).toContain("No product info");
    expect(result!.deviceInfo?.product).toBeNull();
  });
});

// ─── runHealthCheck — JIFFY probe with null bytes ────────────────────────────

describe("runHealthCheck — JIFFY probe null bytes", () => {
  it("fails JIFFY and uses 0 byte count when readMemory resolves with null", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(null);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce(ledReadbackResp)
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.JIFFY.outcome).toBe("Fail");
    expect(result!.probes.JIFFY.reason).toContain("Expected 3 bytes, got 0");
  });
});

// ─── runHealthCheck — CONFIG probe catch block ────────────────────────────────

// Regression: CONFIG probe navigates the `items` intermediate key in real API responses.
// Before the fix, extractConfigItemData looked for the item directly under the category,
// skipping the `items` wrapper and always seeing undefined → "No suitable target".
describe("runHealthCheck — CONFIG probe with items-wrapper format", () => {
  it("succeeds CONFIG when API response uses { items: { [item]: { selected } } } format", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    const itemsResp = { "LED Strip Settings": { items: { "Strip Intensity": { selected: 5, options: [] } } } };
    const itemsReadback = { "LED Strip Settings": { items: { "Strip Intensity": { selected: 6, options: [] } } } };
    mockGetConfigItem
      .mockResolvedValueOnce(itemsResp)
      .mockResolvedValueOnce(itemsReadback)
      .mockResolvedValueOnce(itemsResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Success");
  });

  it("resolves option-list index for non-numeric string selected values", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // Audio Mixer returns selected="OFF" with options=["OFF","-50 dB",...] → index 0
    const audioResp = {
      "LED Strip Settings": {
        items: {
          "Strip Intensity": {
            selected: "OFF",
            options: ["OFF", "+1 dB", "+2 dB"],
          },
        },
      },
    };
    // After delta, expect index 1 ("+" dB)
    const audioReadback = {
      "LED Strip Settings": {
        items: {
          "Strip Intensity": {
            selected: "+1 dB",
            options: ["OFF", "+1 dB", "+2 dB"],
          },
        },
      },
    };
    mockGetConfigItem
      .mockResolvedValueOnce(audioResp)
      .mockResolvedValueOnce(audioReadback)
      .mockResolvedValueOnce(audioResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Success");
  });

  it("round-trips Audio Mixer selections that expose positive dB options", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });

    const audioResp = {
      "LED Strip Settings": {},
      "Audio Mixer": {
        items: {
          "Vol UltiSid 1": {
            selected: "+6 dB",
            options: ["OFF", "+6 dB", "+5 dB", "+4 dB"],
          },
        },
      },
    };
    const audioReadback = {
      "LED Strip Settings": {},
      "Audio Mixer": {
        items: {
          "Vol UltiSid 1": {
            selected: "+5 dB",
            options: ["OFF", "+6 dB", "+5 dB", "+4 dB"],
          },
        },
      },
    };

    let audioMixerReads = 0;
    mockGetConfigItem.mockImplementation((category: string, item: string) => {
      if (category === "LED Strip Settings") return Promise.resolve({ "LED Strip Settings": {} });
      if (category === "Keyboard Lighting") return Promise.resolve({});
      if (category === "Audio Mixer" && item === "Vol UltiSid 1") {
        audioMixerReads += 1;
        if (audioMixerReads === 1) return Promise.resolve(audioResp);
        if (audioMixerReads === 2) return Promise.resolve(audioReadback);
        return Promise.resolve(audioResp);
      }
      return Promise.resolve({});
    });
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();

    expect(result!.probes.CONFIG.outcome).toBe("Success");
    expect(mockSetConfigValue).toHaveBeenNthCalledWith(
      1,
      "Audio Mixer",
      "Vol UltiSid 1",
      2,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
    expect(mockSetConfigValue).toHaveBeenNthCalledWith(
      2,
      "Audio Mixer",
      "Vol UltiSid 1",
      1,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
  });

  it("steps backward within option bounds when the selected Audio Mixer option is already last", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });

    const audioResp = {
      "LED Strip Settings": {},
      "Audio Mixer": {
        items: {
          "Vol UltiSid 1": {
            selected: "+4 dB",
            options: ["OFF", "+6 dB", "+5 dB", "+4 dB"],
          },
        },
      },
    };
    const audioReadback = {
      "LED Strip Settings": {},
      "Audio Mixer": {
        items: {
          "Vol UltiSid 1": {
            selected: "+5 dB",
            options: ["OFF", "+6 dB", "+5 dB", "+4 dB"],
          },
        },
      },
    };

    let audioMixerReads = 0;
    mockGetConfigItem.mockImplementation((category: string, item: string) => {
      if (category === "LED Strip Settings") return Promise.resolve({ "LED Strip Settings": {} });
      if (category === "Keyboard Lighting") return Promise.resolve({});
      if (category === "Audio Mixer" && item === "Vol UltiSid 1") {
        audioMixerReads += 1;
        if (audioMixerReads === 1) return Promise.resolve(audioResp);
        if (audioMixerReads === 2) return Promise.resolve(audioReadback);
        return Promise.resolve(audioResp);
      }
      return Promise.resolve({});
    });
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();

    expect(result!.probes.CONFIG.outcome).toBe("Success");
    expect(mockSetConfigValue).toHaveBeenNthCalledWith(
      1,
      "Audio Mixer",
      "Vol UltiSid 1",
      2,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
    expect(mockSetConfigValue).toHaveBeenNthCalledWith(
      2,
      "Audio Mixer",
      "Vol UltiSid 1",
      3,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
  });
});

describe("runHealthCheck — CONFIG probe exception", () => {
  it("fails CONFIG when getConfigItem throws during the probe", async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === "00A2") return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem.mockRejectedValue(new Error("Config API unavailable"));
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe("Fail");
    expect(result!.probes.CONFIG.reason).toContain("Config API unavailable");
  });
});

// ─── runHealthCheck — outer catch block ──────────────────────────────────────

describe("runHealthCheck — outer catch block", () => {
  it("rethrows when pushHealthHistoryEntry throws unexpectedly", async () => {
    const { pushHealthHistoryEntry } = await import("@/lib/diagnostics/healthHistory");
    vi.mocked(pushHealthHistoryEntry).mockImplementationOnce(() => {
      throw new Error("ring buffer exploded");
    });
    setupAllProbesSuccess();

    await expect(runHealthCheck()).rejects.toThrow("ring buffer exploded");
  });
});

// ─── runHealthCheck — onProbeProgress callback ────────────────────────────────

describe("runHealthCheck — onProbeProgress callback", () => {
  it("invokes callback after each probe in REST→FTP→TELNET→CONFIG→RASTER→JIFFY order", async () => {
    setupAllProbesSuccess();
    const calls: string[][] = [];
    await runHealthCheck((partial) => calls.push(Object.keys(partial)));
    // Each call adds one more probe key in execution order
    expect(calls[0]).toEqual(["REST"]);
    expect(calls[1]).toEqual(["REST", "FTP"]);
    expect(calls[2]).toEqual(["REST", "FTP", "TELNET"]);
    expect(calls[3]).toEqual(["REST", "FTP", "TELNET", "CONFIG"]);
    expect(calls[4]).toEqual(["REST", "FTP", "TELNET", "CONFIG", "RASTER"]);
    expect(calls[5]).toEqual(["REST", "FTP", "TELNET", "CONFIG", "RASTER", "JIFFY"]);
    expect(calls).toHaveLength(6);
  });

  it("callback receives all probes as Skipped after REST failure", async () => {
    mockGetInfo.mockRejectedValue(new Error("Network error"));
    mockListFtpDirectory.mockResolvedValue([]);
    const lastPartial: Record<string, string> = {};
    await runHealthCheck((partial) => {
      for (const [k, v] of Object.entries(partial)) lastPartial[k] = v!.outcome;
    });
    expect(lastPartial["REST"]).toBe("Fail");
    expect(lastPartial["FTP"]).toBe("Skipped");
    expect(lastPartial["TELNET"]).toBe("Skipped");
    expect(lastPartial["CONFIG"]).toBe("Skipped");
    expect(lastPartial["RASTER"]).toBe("Skipped");
    expect(lastPartial["JIFFY"]).toBe("Skipped");
  });

  it("does not throw when no callback is passed", async () => {
    setupAllProbesSuccess();
    await expect(runHealthCheck()).resolves.not.toBeNull();
  });
});
