/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeSmokeMode,
  getSmokeConfig,
  isSmokeModeEnabled,
  isSmokeReadOnlyEnabled,
  recordSmokeStatus,
  recordSmokeBenchmarkSnapshot,
} from "@/lib/smoke/smokeMode";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { addLog } from "@/lib/logging";
import { saveDebugLoggingEnabled } from "@/lib/config/appSettings";
import { featureFlagManager } from "@/lib/config/featureFlags";

import { CURRENT_DEVICE_HOST_KEY as DEVICE_HOST_KEY } from "@/lib/c64api/hostConfig";
const SMOKE_CONFIG_STORAGE_KEY = "c64u_smoke_config";
const SMOKE_MODE_STORAGE_KEY = "c64u_smoke_mode_enabled";

const smokeDeps = vi.hoisted(() => ({
  collectHvscPerfTimingsMock: vi.fn(() => [{ scope: "browse:query", durationMs: 12.3 }]),
  setHvscBaseUrlOverrideMock: vi.fn(),
  buildBaseUrlFromDeviceHostMock: vi.fn((host: string) => `http://${host}`),
  getC64APIConfigSnapshotMock: vi.fn(() => ({ password: "smoke-secret" })),
  updateC64APIConfigMock: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => "web"),
  },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

vi.mock("@/lib/config/appSettings", () => ({
  saveDebugLoggingEnabled: vi.fn(),
}));

vi.mock("@/lib/config/featureFlags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config/featureFlags")>("@/lib/config/featureFlags");
  return {
    ...actual,
    featureFlagManager: {
      load: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      applyBootstrapOverride: vi.fn(async () => undefined),
    },
  };
});

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  collectHvscPerfTimings: (...args: unknown[]) => smokeDeps.collectHvscPerfTimingsMock(...args),
}));

vi.mock("@/lib/hvsc/hvscReleaseService", () => ({
  setHvscBaseUrlOverride: (...args: unknown[]) => smokeDeps.setHvscBaseUrlOverrideMock(...args),
}));

vi.mock("@/lib/c64api", () => ({
  normalizeDeviceHost: (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, ""),
  buildBaseUrlFromDeviceHost: (...args: unknown[]) => smokeDeps.buildBaseUrlFromDeviceHostMock(...args),
  getC64APIConfigSnapshot: (...args: unknown[]) => smokeDeps.getC64APIConfigSnapshotMock(...args),
  updateC64APIConfig: (...args: unknown[]) => smokeDeps.updateC64APIConfigMock(...args),
}));

describe("smokeMode", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = false;
    vi.mocked(addLog).mockClear();
    vi.mocked(saveDebugLoggingEnabled).mockClear();
    vi.mocked(featureFlagManager.load).mockClear();
    vi.mocked(featureFlagManager.reload).mockClear();
    vi.mocked(featureFlagManager.applyBootstrapOverride).mockClear();
    vi.mocked(featureFlagManager.applyBootstrapOverride).mockResolvedValue();
    smokeDeps.collectHvscPerfTimingsMock.mockClear();
    smokeDeps.setHvscBaseUrlOverrideMock.mockClear();
    smokeDeps.buildBaseUrlFromDeviceHostMock.mockClear();
    smokeDeps.getC64APIConfigSnapshotMock.mockClear();
    smokeDeps.updateC64APIConfigMock.mockClear();
    smokeDeps.updateC64APIConfigMock.mockImplementation((_: string, __: string | undefined, deviceHost?: string) => {
      if (deviceHost) {
        localStorage.setItem(DEVICE_HOST_KEY, deviceHost);
      }
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Filesystem.readFile).mockReset();
    vi.mocked(Filesystem.writeFile).mockReset();
    vi.mocked(Filesystem.stat).mockReset();
    // Default: stat resolves so existing tests that mock readFile observe the
    // expected call. Tests for the ENOENT path override stat to reject.
    vi.mocked(Filesystem.stat).mockResolvedValue({
      type: "file",
      size: 0,
      ctime: 0,
      mtime: 0,
      uri: "file:///mock",
    });
    sessionStorage.clear();
  });

  it("initializes from storage and persists host + logging", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "real",
        host: "http://Example.com",
        readOnly: false,
        debugLogging: true,
      }),
    );

    const config = await initializeSmokeMode();

    expect(config).toEqual({
      target: "real",
      host: "example.com",
      readOnly: false,
      debugLogging: true,
    });
    expect(getSmokeConfig()).toEqual(config);
    expect(isSmokeModeEnabled()).toBe(true);
    expect(isSmokeReadOnlyEnabled()).toBe(false);
    expect(localStorage.getItem(DEVICE_HOST_KEY)).toBe("example.com");
    // Config was read FROM storage, so it must not be re-persisted back to
    // storage (HARD9-059) - only a fresh filesystem read mirrors into storage.
    expect(localStorage.getItem(SMOKE_MODE_STORAGE_KEY)).toBeNull();
    expect(smokeDeps.buildBaseUrlFromDeviceHostMock).toHaveBeenCalledWith("example.com");
    expect(smokeDeps.getC64APIConfigSnapshotMock).toHaveBeenCalledTimes(1);
    expect(smokeDeps.updateC64APIConfigMock).toHaveBeenCalledWith("http://example.com", "smoke-secret", "example.com");
    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
    expect(addLog).toHaveBeenCalledWith("info", "Smoke mode enabled", expect.any(Object));
  });

  it("loads config from native storage when the bootstrap flag is enabled", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.readFile).mockResolvedValue({
      data: JSON.stringify({
        target: "mock",
        readOnly: true,
        debugLogging: false,
      }),
    });

    const config = await initializeSmokeMode();

    expect(config).toEqual({
      target: "mock",
      host: undefined,
      readOnly: true,
      debugLogging: false,
    });
    expect(saveDebugLoggingEnabled).not.toHaveBeenCalled();
    // A fresh filesystem read IS mirrored into storage - a perf cache for the
    // next cold launch, avoiding a Filesystem round-trip (HARD9-059).
    expect(localStorage.getItem(SMOKE_CONFIG_STORAGE_KEY)).toBe(JSON.stringify(config));
    expect(localStorage.getItem(SMOKE_MODE_STORAGE_KEY)).toBe("1");
  });

  it("keeps local source initial URI from smoke config for Android picker automation", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
        localSourceInitialUri:
          "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FC64LocalSource",
        resetLocalSourcePermissions: true,
      }),
    );

    const config = await initializeSmokeMode();

    expect(config?.localSourceInitialUri).toBe(
      "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FC64LocalSource",
    );
    expect(getSmokeConfig()?.localSourceInitialUri).toBe(
      "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FC64LocalSource",
    );
    expect(config?.resetLocalSourcePermissions).toBe(true);
  });

  it("prefers the native smoke config file over stale local storage during no-reset automation", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
        localSourceInitialUri: "content://com.android.externalstorage.documents/tree/primary%3ADownload",
      }),
    );
    vi.mocked(Filesystem.readFile).mockResolvedValue({
      data: JSON.stringify({
        target: "mock",
        localSourceInitialUri:
          "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FC64LocalSource",
      }),
    });

    const config = await initializeSmokeMode();

    expect(config?.localSourceInitialUri).toBe(
      "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FC64LocalSource",
    );
    expect(JSON.parse(localStorage.getItem(SMOKE_CONFIG_STORAGE_KEY) ?? "{}")).toMatchObject({
      localSourceInitialUri: "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FC64LocalSource",
    });
  });

  it("reads native smoke config on a cold start when the bootstrap flag is enabled", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.readFile).mockResolvedValue({
      data: JSON.stringify({
        target: "real",
        host: "192.168.1.13",
        readOnly: true,
        debugLogging: false,
      }),
    });

    const config = await initializeSmokeMode();

    expect(config).toEqual({
      target: "real",
      host: "192.168.1.13",
      readOnly: true,
      debugLogging: false,
    });
    expect(Filesystem.readFile).toHaveBeenCalledWith({
      path: "c64u-smoke.json",
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
  });

  it("applies smoke feature flags through the unified manager during initialization", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
        featureFlags: {
          hvsc_enabled: true,
        },
      }),
    );

    const config = await initializeSmokeMode();

    expect(config?.featureFlags).toEqual({ hvsc_enabled: true });
    expect(featureFlagManager.load).toHaveBeenCalledTimes(1);
    expect(featureFlagManager.applyBootstrapOverride).toHaveBeenCalledWith("hvsc_enabled", true);
  });

  it("ignores unknown or invalid smoke feature flag values", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
        featureFlags: {
          hvsc_enabled: "yes",
          unknown_flag: true,
        },
      }),
    );

    const config = await initializeSmokeMode();

    expect(config?.featureFlags).toBeUndefined();
    expect(featureFlagManager.applyBootstrapOverride).not.toHaveBeenCalled();
  });

  it("logs a warning when applying a smoke feature flag fails", async () => {
    vi.mocked(featureFlagManager.applyBootstrapOverride).mockRejectedValueOnce(new Error("bootstrap write failed"));
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
        featureFlags: {
          hvsc_enabled: false,
        },
      }),
    );

    const config = await initializeSmokeMode();

    expect(config?.featureFlags).toEqual({ hvsc_enabled: false });
    expect(addLog).toHaveBeenCalledWith("warn", "Failed to apply smoke feature flag", expect.any(Object));
  });

  it("records smoke status on native platforms", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "real",
        readOnly: true,
        debugLogging: false,
      }),
    );

    await initializeSmokeMode();
    await recordSmokeStatus({ state: "DEMO_ACTIVE", mode: "demo" });

    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: "c64u-smoke-status.json",
      directory: Directory.Data,
      data: expect.stringContaining("DEMO_ACTIVE"),
      encoding: Encoding.UTF8,
    });
  });

  it("applies an HVSC base URL override during initialization", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "real",
        host: "u64",
        hvscBaseUrl: "https://example.invalid/hvsc/",
      }),
    );

    await initializeSmokeMode();

    expect(smokeDeps.setHvscBaseUrlOverrideMock).toHaveBeenCalledWith("https://example.invalid/hvsc/");
  });

  it("records smoke benchmark snapshots with timings and benchmark metadata", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "real",
        host: "u64",
        hvscBaseUrl: "https://example.invalid/hvsc/",
        benchmarkRunId: "run-123",
      }),
    );

    await initializeSmokeMode();
    await recordSmokeBenchmarkSnapshot({
      scenario: "Browse Query",
      state: "complete",
      metadata: {
        path: "/DEMOS/0-9",
      },
    });

    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: "c64u-smoke-benchmark-browse-query.json",
      directory: Directory.Data,
      data: expect.any(String),
      encoding: Encoding.UTF8,
    });

    const payload = JSON.parse(vi.mocked(Filesystem.writeFile).mock.calls[0]?.[0]?.data as string);
    expect(payload).toEqual(
      expect.objectContaining({
        scenario: "browse-query",
        state: "complete",
        target: "real",
        host: "u64",
        hvscBaseUrl: "https://example.invalid/hvsc/",
        benchmarkRunId: "run-123",
        metadata: { path: "/DEMOS/0-9" },
        hvscPerfTimings: [{ scope: "browse:query", durationMs: 12.3 }],
      }),
    );
  });

  it("returns null for invalid config target", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "invalid-target",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(isSmokeModeEnabled()).toBe(false);
  });

  it("returns null for non-object config", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(SMOKE_CONFIG_STORAGE_KEY, '"not an object"');

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
  });

  it("handles malformed JSON in storage gracefully", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(SMOKE_CONFIG_STORAGE_KEY, "{broken json");

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("parse"), expect.any(Object));
  });

  it("skips host persistence when host is absent", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config?.host).toBeUndefined();
    expect(localStorage.getItem(DEVICE_HOST_KEY)).toBeNull();
  });

  it("defaults readOnly to true when not specified", async () => {
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config?.readOnly).toBe(true);
    expect(isSmokeReadOnlyEnabled()).toBe(true);
  });

  it("skips recordSmokeStatus when config not initialized", async () => {
    await recordSmokeStatus({ state: "DEMO_ACTIVE" });
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("skips recordSmokeStatus on non-native platform", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
      }),
    );
    await initializeSmokeMode();
    await recordSmokeStatus({ state: "DEMO_ACTIVE" });
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("logs warning when recordSmokeStatus write fails", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "mock",
      }),
    );
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error("write error"));

    await initializeSmokeMode();
    await recordSmokeStatus({ state: "DEMO_ACTIVE" });
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("smoke status"), expect.any(Object));
  });

  it("uses stat-then-read so a missing optional file does not call readFile", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error("File does not exist"));

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
    // ENOENT must be silent — no debug or warn for the expected absence.
    expect(addLog).not.toHaveBeenCalledWith("warn", expect.stringContaining("smoke"), expect.any(Object));
  });

  it("does not probe filesystem for smoke config in native production mode without explicit opt-in", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    const config = await initializeSmokeMode();

    expect(config).toBeNull();
    expect(Filesystem.stat).not.toHaveBeenCalled();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });

  it("does not latch into smoke mode from a stray localStorage key without explicit opt-in (HARD9-059)", async () => {
    // A key left over from any past smoke/E2E run on the same device profile
    // must not silently and permanently enable smoke mode in a production
    // build - the localStorage fallback needs the SAME explicit probe-context
    // opt-in the filesystem path already requires.
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "real",
        host: "u64",
        readOnly: false,
      }),
    );

    const config = await initializeSmokeMode();

    expect(config).toBeNull();
    expect(isSmokeModeEnabled()).toBe(false);
  });

  it("logs a warning when stat fails for a non-missing reason", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error("Permission denied"));

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("stat"), expect.any(Object));
  });

  it("logs a warning when readFile fails after a successful stat", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("Read failure"));

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("read smoke"), expect.any(Object));
  });

  it("reads from filesystem via VITE_ENABLE_TEST_PROBES", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const originalEnv = import.meta.env.VITE_ENABLE_TEST_PROBES;
    import.meta.env.VITE_ENABLE_TEST_PROBES = "1";
    vi.mocked(Filesystem.readFile).mockResolvedValue({
      data: JSON.stringify({ target: "mock" }),
    });

    const config = await initializeSmokeMode();
    expect(config?.target).toBe("mock");

    import.meta.env.VITE_ENABLE_TEST_PROBES = originalEnv;
  });

  it("normalizes host with empty string to undefined", async () => {
    localStorage.setItem(
      SMOKE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        target: "real",
        host: "  ",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config?.host).toBeUndefined();
  });

  it("treats a string ENOENT rejection from stat as a silent missing file", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.stat).mockRejectedValue("File does not exist");

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
    expect(addLog).not.toHaveBeenCalledWith("warn", expect.stringContaining("smoke"), expect.any(Object));
  });

  it("treats a nested {error: '...not found...'} rejection from stat as silent", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.stat).mockRejectedValue({ error: "File not found" });

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });

  it("treats a nested {error: {message}} rejection from stat as silent when it is a missing-file message", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.stat).mockRejectedValue({ error: { message: "no such file" } });

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });

  it("warns when stat rejects with an opaque non-string value", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.stat).mockRejectedValue(42);

    const config = await initializeSmokeMode();

    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("stat"), expect.any(Object));
  });

  describe("snapshot write throttle", () => {
    const initSmokeNative = async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
      localStorage.setItem(
        SMOKE_CONFIG_STORAGE_KEY,
        JSON.stringify({ target: "real", host: "u64", benchmarkRunId: "run-t" }),
      );
      await initializeSmokeMode();
    };

    it("throttles rapid writes for the same scenario", async () => {
      vi.useFakeTimers({ now: 100_000 });
      try {
        await initSmokeNative();

        await recordSmokeBenchmarkSnapshot({ scenario: "throttle-same" });
        expect(Filesystem.writeFile).toHaveBeenCalledTimes(1);

        // Second call within 2 s — should be suppressed
        vi.advanceTimersByTime(500);
        await recordSmokeBenchmarkSnapshot({ scenario: "throttle-same" });
        expect(Filesystem.writeFile).toHaveBeenCalledTimes(1);

        // Advance past the throttle window
        vi.advanceTimersByTime(2_000);
        await recordSmokeBenchmarkSnapshot({ scenario: "throttle-same" });
        expect(Filesystem.writeFile).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("allows concurrent writes for different scenarios", async () => {
      vi.useFakeTimers({ now: 200_000 });
      try {
        await initSmokeNative();

        await recordSmokeBenchmarkSnapshot({ scenario: "scenario-a" });
        await recordSmokeBenchmarkSnapshot({ scenario: "scenario-b" });
        expect(Filesystem.writeFile).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
